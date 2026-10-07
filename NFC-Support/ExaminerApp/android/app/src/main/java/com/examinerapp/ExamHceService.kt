package com.examinerapp

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import org.json.JSONObject

class ExamHceService : HostApduService() {

    companion object {
        var examDataJson: String = ""
        var isActive: Boolean = false
        var secureProvisioningEnabled: Boolean = false
        // {"sessionId", "nmec", "apiBaseUrl", "ttlSec"} — see App.tsx.
        var securePayloadJson: String = ""
        // Session-scoped secret this app generated and registered with the
        // server; delivered to the device, encrypted, by GET_PROVISION_TOKEN.
        var sharedSecretB64u: String = ""

        // Holds a freshly created, not-yet-delivered device identity — see
        // pie-api-main/docs/device-identity-nfc-bootstrap.md section 2.
        // Empty means "nothing pending", so an unrelated tap against this
        // phone can't accidentally claim a device.
        var pendingDeviceIdentityJson: String = ""

        private val SW_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val SW_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69.toByte(), 0x85.toByte())
        private val SW_WRONG_INS = byteArrayOf(0x6D.toByte(), 0x00)
        private val SW_WRONG_LENGTH = byteArrayOf(0x67.toByte(), 0x00)
        private const val SW1_MORE_DATA = 0x61

        private const val INS_SELECT_AID = 0xA4
        private const val INS_GET_EXAM_DATA = 0xCA
        private const val INS_SET_READER_CHALLENGE = 0xCB
        private const val INS_GET_PROVISION_TOKEN = 0xCC
        private const val INS_GET_DEVICE_IDENTITY = 0xCD
        private const val INS_GET_RESPONSE = 0xC0

        private const val MAX_RESPONSE_BODY_BYTES = 240
        private val SERVICE_AID = byteArrayOf(
            0xF0.toByte(), 0x45.toByte(), 0x58.toByte(), 0x4D.toByte(),
            0x41.toByte(), 0x50.toByte(), 0x50.toByte(), 0x31.toByte(),
        )
        private var aidSelected: Boolean = false
        // The reader's per-tap P-256 public key, sent in SET_READER_CHALLENGE.
        private var readerPublicKey: ByteArray? = null
        // Remainder of a response too long for one APDU, served by GET RESPONSE.
        private var pendingResponse: ByteArray = ByteArray(0)
    }

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (!isActive || commandApdu.size < 4) return SW_FILE_NOT_FOUND

        return when (commandApdu[1].toInt() and 0xFF) {
            INS_SELECT_AID -> handleSelectAid(commandApdu)
            INS_GET_EXAM_DATA -> handleGetExamData()
            INS_SET_READER_CHALLENGE -> handleSetReaderChallenge(commandApdu)
            INS_GET_PROVISION_TOKEN -> handleGetProvisionToken()
            INS_GET_DEVICE_IDENTITY -> handleGetDeviceIdentity()
            INS_GET_RESPONSE -> handleGetResponse()
            else -> SW_WRONG_INS
        }
    }

    private fun handleSelectAid(commandApdu: ByteArray): ByteArray {
        if (!matchesAid(commandApdu)) return SW_FILE_NOT_FOUND
        aidSelected = true
        return SW_SUCCESS
    }

    private fun handleGetExamData(): ByteArray {
        if (!aidSelected) return SW_CONDITIONS_NOT_SATISFIED

        if (secureProvisioningEnabled) {
            return SW_CONDITIONS_NOT_SATISFIED
        }

        if (examDataJson.isBlank()) return SW_CONDITIONS_NOT_SATISFIED

        val parsed = try {
            JSONObject(examDataJson)
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }

        val response = JSONObject()
            .put("sessionId", parsed.optString("sessionId", ""))
            .put("nmec", parsed.optString("nmec", ""))
            .put("timestamp", parsed.optString("timestamp", ""))

        return respondWithJson(response)
    }

    private fun handleSetReaderChallenge(commandApdu: ByteArray): ByteArray {
        if (!aidSelected) return SW_CONDITIONS_NOT_SATISFIED
        if (!secureProvisioningEnabled && pendingDeviceIdentityJson.isBlank()) {
            return SW_CONDITIONS_NOT_SATISFIED
        }

        val data = extractData(commandApdu) ?: return SW_WRONG_LENGTH
        if (!NfcCrypto.isValidReaderPublicKey(data)) return SW_WRONG_LENGTH

        readerPublicKey = data
        return SW_SUCCESS
    }

    private fun handleGetProvisionToken(): ByteArray {
        if (!aidSelected) return SW_CONDITIONS_NOT_SATISFIED
        if (!secureProvisioningEnabled) return SW_CONDITIONS_NOT_SATISFIED
        if (securePayloadJson.isBlank() || sharedSecretB64u.isBlank()) return SW_CONDITIONS_NOT_SATISFIED
        val readerKey = readerPublicKey ?: return SW_CONDITIONS_NOT_SATISFIED

        val parsed = try {
            JSONObject(securePayloadJson)
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }
        val sessionId = parsed.optString("sessionId", "").toLongOrNull() ?: return SW_FILE_NOT_FOUND

        val nowEpochSec = System.currentTimeMillis() / 1000
        val ttlSec = parsed.optLong("ttlSec", 60L).coerceIn(10L, 600L)

        // Short keys keep the envelope close to one APDU; the full layout is
        // documented in examiner-trusted-node-provisioning.md section 3.
        val payload = JSONObject()
            .put("v", 2)
            .put("sid", sessionId)
            .put("nm", parsed.optString("nmec", ""))
            .put("k", sharedSecretB64u)
            .put("u", parsed.optString("apiBaseUrl", ""))
            .put("exp", nowEpochSec + ttlSec)

        return respondEncrypted(readerKey, INS_GET_PROVISION_TOKEN, payload)
    }

    private fun handleGetDeviceIdentity(): ByteArray {
        if (!aidSelected) return SW_CONDITIONS_NOT_SATISFIED
        if (pendingDeviceIdentityJson.isBlank()) return SW_FILE_NOT_FOUND
        val readerKey = readerPublicKey ?: return SW_CONDITIONS_NOT_SATISFIED

        val parsed = try {
            JSONObject(pendingDeviceIdentityJson)
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }

        val response = JSONObject()
            .put("deviceId", parsed.optInt("deviceId"))
            .put("apiKey", parsed.optString("apiKey"))
            .put("apiBaseUrl", parsed.optString("apiBaseUrl"))

        // Single-use on the phone side too, whether or not the reader
        // actually accepts this response — a second stray tap must not be
        // able to redeliver the same key (design doc section 2, step 6).
        pendingDeviceIdentityJson = ""

        return respondEncrypted(readerKey, INS_GET_DEVICE_IDENTITY, response)
    }

    private fun handleGetResponse(): ByteArray {
        if (!aidSelected || pendingResponse.isEmpty()) return SW_CONDITIONS_NOT_SATISFIED
        return nextResponseChunk()
    }

    private fun matchesAid(commandApdu: ByteArray): Boolean {
        if (commandApdu.size < 5) return false
        val lc = commandApdu[4].toInt() and 0xFF
        if (lc != SERVICE_AID.size || commandApdu.size < 5 + lc) return false
        val incomingAid = commandApdu.copyOfRange(5, 5 + lc)
        return incomingAid.contentEquals(SERVICE_AID)
    }

    private fun extractData(commandApdu: ByteArray): ByteArray? {
        if (commandApdu.size < 5) return null
        val lc = commandApdu[4].toInt() and 0xFF
        if (lc == 0) return ByteArray(0)
        if (commandApdu.size < 5 + lc) return null
        return commandApdu.copyOfRange(5, 5 + lc)
    }

    private fun respondWithJson(json: JSONObject): ByteArray {
        val body = json.toString().toByteArray(Charsets.UTF_8)
        if (body.size > MAX_RESPONSE_BODY_BYTES) return SW_FILE_NOT_FOUND
        return body + SW_SUCCESS
    }

    private fun respondEncrypted(readerKey: ByteArray, ins: Int, json: JSONObject): ByteArray {
        pendingResponse = try {
            NfcCrypto.encryptForReader(readerKey, ins, json.toString().toByteArray(Charsets.UTF_8))
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }
        // One key per tap: a second command in the same tap must not get a
        // second envelope under the same reader key.
        readerPublicKey = null
        return nextResponseChunk()
    }

    /** ISO 7816-4 response chaining: up to MAX_RESPONSE_BODY_BYTES per APDU,
     * `61xx` while more remains (xx = bytes left, 00 meaning 256 or more),
     * `9000` on the last chunk. */
    private fun nextResponseChunk(): ByteArray {
        val chunkSize = minOf(MAX_RESPONSE_BODY_BYTES, pendingResponse.size)
        val chunk = pendingResponse.copyOfRange(0, chunkSize)
        pendingResponse = pendingResponse.copyOfRange(chunkSize, pendingResponse.size)
        if (pendingResponse.isEmpty()) return chunk + SW_SUCCESS
        val remaining = if (pendingResponse.size >= 256) 0 else pendingResponse.size
        return chunk + byteArrayOf(SW1_MORE_DATA.toByte(), remaining.toByte())
    }

    override fun onDeactivated(reason: Int) {
        aidSelected = false
        readerPublicKey = null
        pendingResponse = ByteArray(0)
    }
}
