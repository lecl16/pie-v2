package com.examinerapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.AlgorithmIdentifier
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo
import org.bouncycastle.asn1.x9.X9ObjectIdentifiers
import org.bouncycastle.operator.ContentSigner
import org.bouncycastle.pkcs.PKCS10CertificationRequestBuilder

/**
 * This phone's client credential for the PIE API's phone port — see
 * pie-api-main/README.md, "Phone enrollment". The private key is
 * generated in the Android Keystore and never leaves it; the certificate the
 * server issues for it is kept in the app's preferences.
 */
object PhoneCredential {
    const val ALIAS = "pie-examiner-phone"
    private const val PREFS = "pie_phone_credential"
    private const val PREF_CERT = "certificate_pem"
    private const val PREF_MTLS_PORT = "mtls_port"

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /**
     * Generates a fresh key pair, replacing any previous credential, and
     * returns a PKCS#10 request for it (PEM), signed with the new key so the
     * server knows the phone holds it.
     */
    fun createCsr(context: Context): String {
        clear(context)

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                // DIGEST_NONE: the TLS stack (Conscrypt) hashes the handshake
                // itself and asks the Keystore for a raw ECDSA signature.
                .setDigests(
                    KeyProperties.DIGEST_NONE,
                    KeyProperties.DIGEST_SHA256,
                    KeyProperties.DIGEST_SHA384,
                    KeyProperties.DIGEST_SHA512,
                )
                .build(),
        )
        val keyPair = generator.generateKeyPair()

        // The server ignores the subject and names the certificate itself.
        val signer = object : ContentSigner {
            private val buffer = ByteArrayOutputStream()
            override fun getAlgorithmIdentifier() = AlgorithmIdentifier(X9ObjectIdentifiers.ecdsa_with_SHA256)
            override fun getOutputStream(): OutputStream = buffer
            override fun getSignature(): ByteArray =
                Signature.getInstance("SHA256withECDSA").run {
                    initSign(keyPair.private)
                    update(buffer.toByteArray())
                    sign()
                }
        }
        val csr = PKCS10CertificationRequestBuilder(
            X500Name("CN=PIE Examiner App"),
            SubjectPublicKeyInfo.getInstance(keyPair.public.encoded),
        ).build(signer)

        return pem("CERTIFICATE REQUEST", csr.encoded)
    }

    /** Stores the certificate the server issued, after checking it is for this phone's key. */
    fun storeCertificate(context: Context, certificatePem: String, mtlsPort: Int) {
        val certificate = parseCertificate(certificatePem)
        val keyCertificate = keyStore().getCertificate(ALIAS)
            ?: throw IllegalStateException("No phone key; create a request first")
        require(certificate.publicKey.encoded.contentEquals(keyCertificate.publicKey.encoded)) {
            "The certificate is not for this phone's key"
        }
        prefs(context).edit()
            .putString(PREF_CERT, certificatePem)
            .putInt(PREF_MTLS_PORT, mtlsPort)
            .apply()
    }

    fun certificate(context: Context): X509Certificate? {
        val certificatePem = prefs(context).getString(PREF_CERT, null) ?: return null
        if (!keyStore().containsAlias(ALIAS)) return null
        return runCatching { parseCertificate(certificatePem) }.getOrNull()
    }

    fun mtlsPort(context: Context): Int = prefs(context).getInt(PREF_MTLS_PORT, 0)

    fun privateKey(): PrivateKey? = keyStore().getKey(ALIAS, null) as? PrivateKey

    fun fingerprint(certificate: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
            .joinToString("") { "%02x".format(it) }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
        keyStore().run { if (containsAlias(ALIAS)) deleteEntry(ALIAS) }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun parseCertificate(certificatePem: String): X509Certificate =
        CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(certificatePem.toByteArray())) as X509Certificate

    private fun pem(type: String, der: ByteArray): String {
        val base64 = Base64.encodeToString(der, Base64.NO_WRAP)
        return "-----BEGIN $type-----\n" + base64.chunked(64).joinToString("\n") + "\n-----END $type-----\n"
    }
}

/**
 * Presents the phone's certificate when a server asks for one — only the
 * PIE API's phone port does (pie-api-main/Caddyfile). Read at every
 * handshake, so a certificate stored after enrollment is used straight away.
 */
class PhoneKeyManager(private val context: Context) : X509ExtendedKeyManager() {
    private fun alias(): String? =
        if (PhoneCredential.certificate(context) != null) PhoneCredential.ALIAS else null

    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = alias()

    override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?) = alias()

    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? =
        alias()?.let { arrayOf(it) }

    override fun getCertificateChain(alias: String?): Array<X509Certificate>? =
        if (alias == PhoneCredential.ALIAS) PhoneCredential.certificate(context)?.let { arrayOf(it) } else null

    override fun getPrivateKey(alias: String?): PrivateKey? =
        if (alias == PhoneCredential.ALIAS) PhoneCredential.privateKey() else null

    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null

    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null
}
