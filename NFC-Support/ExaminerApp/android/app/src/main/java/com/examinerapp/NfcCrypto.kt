package com.examinerapp

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypts an NFC response to the reader's per-tap public key — see
 * pie-api-main/README.md, "Session provisioning". Must
 * match decrypt_envelope() in NFC-Support/reader_script.py.
 *
 * Envelope: phone_pub (65) || nonce (12) || AES-256-GCM ciphertext+tag, with
 * key = HKDF-SHA256(ECDH(phone, reader), salt = reader_pub || phone_pub,
 * info = "PIE-NFC-v2") and the command's INS byte as AAD. P-256 rather than
 * X25519 because Android only ships X25519 key agreement from API 31, and
 * this app's minSdk is 24.
 */
object NfcCrypto {
    const val P256_PUBLIC_KEY_BYTES = 65
    private const val COORDINATE_BYTES = 32
    private const val GCM_NONCE_BYTES = 12
    private const val GCM_TAG_BITS = 128
    private val HKDF_INFO = "PIE-NFC-v2".toByteArray(Charsets.US_ASCII)

    private val random = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }

    fun isValidReaderPublicKey(raw: ByteArray): Boolean =
        raw.size == P256_PUBLIC_KEY_BYTES && raw[0] == 0x04.toByte()

    fun encryptForReader(readerPublicRaw: ByteArray, ins: Int, plaintext: ByteArray): ByteArray {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), random)
        val phoneKeyPair = generator.generateKeyPair()
        val phonePublic = phoneKeyPair.public as ECPublicKey
        val phonePublicRaw = encodeUncompressed(phonePublic.w)

        // Decoding the reader's point with the phone key's own curve params
        // also validates the point is on P-256 (KeyFactory rejects it otherwise).
        val readerPublic = KeyFactory.getInstance("EC").generatePublic(
            ECPublicKeySpec(decodeUncompressed(readerPublicRaw), phonePublic.params),
        )

        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(phoneKeyPair.private)
        agreement.doPhase(readerPublic, true)
        val shared = agreement.generateSecret()

        val key = hkdfSha256(shared, readerPublicRaw + phonePublicRaw, HKDF_INFO, 32)
        val nonce = randomBytes(GCM_NONCE_BYTES)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(byteArrayOf(ins.toByte()))
        return phonePublicRaw + nonce + cipher.doFinal(plaintext)
    }

    private fun encodeUncompressed(point: ECPoint): ByteArray =
        byteArrayOf(0x04) + toFixedLength(point.affineX) + toFixedLength(point.affineY)

    private fun decodeUncompressed(raw: ByteArray): ECPoint {
        require(isValidReaderPublicKey(raw)) { "Not an uncompressed P-256 point" }
        val x = BigInteger(1, raw.copyOfRange(1, 1 + COORDINATE_BYTES))
        val y = BigInteger(1, raw.copyOfRange(1 + COORDINATE_BYTES, P256_PUBLIC_KEY_BYTES))
        return ECPoint(x, y)
    }

    private fun toFixedLength(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        return when {
            bytes.size == COORDINATE_BYTES -> bytes
            bytes.size > COORDINATE_BYTES -> bytes.copyOfRange(bytes.size - COORDINATE_BYTES, bytes.size)
            else -> ByteArray(COORDINATE_BYTES - bytes.size) + bytes
        }
    }

    /** RFC 5869, single-block expand is enough for a 32-byte output. */
    private fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = extract.doFinal(ikm)

        val expand = Mac.getInstance("HmacSHA256")
        expand.init(SecretKeySpec(prk, "HmacSHA256"))
        expand.update(info)
        expand.update(0x01)
        return expand.doFinal().copyOf(length)
    }
}
