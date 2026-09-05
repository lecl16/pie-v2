package com.examinerapp

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ExamHceService : HostApduService() {

    companion object {
        var examDataJson: String = ""
        var isActive: Boolean = false
        var secureProvisioningEnabled: Boolean = false
        var securePayloadJson: String = ""
        var sharedSecretB64u: String = ""

        private val SW_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val SW_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69.toByte(), 0x85.toByte())
        private val SW_WRONG_INS = byteArrayOf(0x6D.toByte(), 0x00)
        private val SW_WRONG_LENGTH = byteArrayOf(0x67.toByte(), 0x00)

        private const val INS_SELECT_AID = 0xA4
        private const val INS_GET_EXAM_DATA = 0xCA
        private const val INS_SET_READER_CHALLENGE = 0xCB
        private const val INS_GET_PROVISION_TOKEN = 0xCC

        private const val MAX_RESPONSE_BODY_BYTES = 240
        private val SERVICE_AID = byteArrayOf(
            0xF0.toByte(), 0x45.toByte(), 0x58.toByte(), 0x4D.toByte(),
            0x41.toByte(), 0x50.toByte(), 0x50.toByte(), 0x31.toByte(),
        )
        private var aidSelected: Boolean = false
        private var lastReaderChallengeB64u: String = ""
        private val random = SecureRandom()
    }

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (!isActive || commandApdu.size < 4) return SW_FILE_NOT_FOUND

        return when (commandApdu[1].toInt() and 0xFF) {
            INS_SELECT_AID -> handleSelectAid(commandApdu)
            INS_GET_EXAM_DATA -> handleGetExamData()
            INS_SET_READER_CHALLENGE -> handleSetReaderChallenge(commandApdu)
            INS_GET_PROVISION_TOKEN -> handleGetProvisionToken()
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
        if (!secureProvisioningEnabled) return SW_CONDITIONS_NOT_SATISFIED

        val data = extractData(commandApdu) ?: return SW_WRONG_LENGTH
        if (data.isEmpty()) return SW_WRONG_LENGTH

        lastReaderChallengeB64u = encodeB64u(data)
        return SW_SUCCESS
    }

    private fun handleGetProvisionToken(): ByteArray {
        if (!aidSelected) return SW_CONDITIONS_NOT_SATISFIED
        if (!secureProvisioningEnabled) return SW_CONDITIONS_NOT_SATISFIED
        if (securePayloadJson.isBlank() || sharedSecretB64u.isBlank()) return SW_CONDITIONS_NOT_SATISFIED
        if (lastReaderChallengeB64u.isBlank()) return SW_CONDITIONS_NOT_SATISFIED

        val parsed = try {
            JSONObject(securePayloadJson)
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }

        val nowEpochSec = System.currentTimeMillis() / 1000
        val ttlSec = parsed.optLong("ttlSec", 60L).coerceIn(10L, 600L)
        val exp = nowEpochSec + ttlSec

        val token = JSONObject()
            .put("v", 1)
            .put("jti", randomTokenId())
            .put("exp", exp)
            .put("ch", lastReaderChallengeB64u)
            .put("sid", parsed.optString("sessionId", ""))
            .put("nm", parsed.optString("nmec", ""))
            .put("ts", parsed.optString("timestamp", ""))

        val tokenJson = token.toString()
        val mac = try {
            hmacSha256(decodeB64u(sharedSecretB64u), tokenJson.toByteArray(Charsets.UTF_8))
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }

        val response = JSONObject()
            .put("t", token)
            .put("m", encodeB64u(mac))

        return respondWithJson(response)
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

    private fun hmacSha256(key: ByteArray, message: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(message)
    }

    private fun encodeB64u(raw: ByteArray): String {
        return Base64.encodeToString(raw, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
    }

    private fun decodeB64u(text: String): ByteArray {
        return Base64.decode(text, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
    }

    private fun randomTokenId(): String {
        val bytes = ByteArray(12)
        random.nextBytes(bytes)
        return encodeB64u(bytes)
    }

    private fun respondWithJson(json: JSONObject): ByteArray {
        val body = json.toString().toByteArray(Charsets.UTF_8)
        if (body.size > MAX_RESPONSE_BODY_BYTES) return SW_FILE_NOT_FOUND
        return body + SW_SUCCESS
    }

    override fun onDeactivated(reason: Int) {
        aidSelected = false
        lastReaderChallengeB64u = ""
    }
}
