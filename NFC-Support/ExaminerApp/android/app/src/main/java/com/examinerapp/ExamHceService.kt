package com.examinerapp

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import org.json.JSONObject

class ExamHceService : HostApduService() {

    companion object {
        var examDataJson: String = ""
        var isActive: Boolean = false

        private val SW_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val SW_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69.toByte(), 0x85.toByte())
        private val SW_WRONG_INS = byteArrayOf(0x6D.toByte(), 0x00)

        private const val INS_SELECT_AID = 0xA4
        private const val INS_GET_EXAM_DATA = 0xCA

        private const val MAX_RESPONSE_BODY_BYTES = 240
        private val SERVICE_AID = byteArrayOf(
            0xF0.toByte(), 0x45.toByte(), 0x58.toByte(), 0x4D.toByte(),
            0x41.toByte(), 0x50.toByte(), 0x50.toByte(), 0x31.toByte(),
        )
        private var aidSelected: Boolean = false
    }

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (!isActive || commandApdu.size < 4) return SW_FILE_NOT_FOUND

        return when (commandApdu[1].toInt() and 0xFF) {
            INS_SELECT_AID -> handleSelectAid(commandApdu)
            INS_GET_EXAM_DATA -> handleGetExamData()
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
        if (examDataJson.isBlank()) return SW_CONDITIONS_NOT_SATISFIED

        val parsed = try {
            JSONObject(examDataJson)
        } catch (_: Exception) {
            return SW_FILE_NOT_FOUND
        }

        val response = JSONObject()
            .put("ip", parsed.optString("ip", ""))
            .put("sessionId", parsed.optString("sessionId", ""))
            .put("nmec", parsed.optString("nmec", ""))
            .put("timestamp", parsed.optString("timestamp", ""))

        return respondWithJson(response)
    }

    private fun matchesAid(commandApdu: ByteArray): Boolean {
        if (commandApdu.size < 5) return false
        val lc = commandApdu[4].toInt() and 0xFF
        if (lc != SERVICE_AID.size || commandApdu.size < 5 + lc) return false
        val incomingAid = commandApdu.copyOfRange(5, 5 + lc)
        return incomingAid.contentEquals(SERVICE_AID)
    }

    private fun respondWithJson(json: JSONObject): ByteArray {
        val body = json.toString().toByteArray(Charsets.UTF_8)
        if (body.size > MAX_RESPONSE_BODY_BYTES) return SW_FILE_NOT_FOUND
        return body + SW_SUCCESS
    }

    override fun onDeactivated(reason: Int) {
        aidSelected = false
    }
}
