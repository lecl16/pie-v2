package com.examinerapp

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * JS access to PhoneCredential: the app enrolls the phone after login and
 * then sends the trusted-node calls to the phone port — see
 * pie-api-main/docs/examiner-phone-enrollment.md.
 */
class PhoneCredentialModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PhoneCredentialModule"

    private fun status(): WritableMap {
        val certificate = PhoneCredential.certificate(reactContext)
        return Arguments.createMap().apply {
            putBoolean("enrolled", certificate != null)
            if (certificate != null) {
                putString("fingerprint", PhoneCredential.fingerprint(certificate))
                putString("subject", certificate.subjectX500Principal.name)
                putDouble("expiresAt", certificate.notAfter.time.toDouble())
                putInt("mtlsPort", PhoneCredential.mtlsPort(reactContext))
            }
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        runCatching { status() }.fold(promise::resolve) { promise.reject("E_PHONE_CREDENTIAL", it) }
    }

    /** New key pair (replacing any previous credential) and its request, PEM. */
    @ReactMethod
    fun createCsr(promise: Promise) {
        runCatching { PhoneCredential.createCsr(reactContext) }
            .fold(promise::resolve) { promise.reject("E_PHONE_CREDENTIAL", it) }
    }

    @ReactMethod
    fun storeCertificate(certificatePem: String, mtlsPort: Int, promise: Promise) {
        runCatching {
            PhoneCredential.storeCertificate(reactContext, certificatePem, mtlsPort)
            PhoneTls.reset()
            status()
        }.fold(promise::resolve) { promise.reject("E_PHONE_CREDENTIAL", it) }
    }

    @ReactMethod
    fun clear(promise: Promise) {
        runCatching {
            PhoneCredential.clear(reactContext)
            PhoneTls.reset()
        }
            .fold({ promise.resolve(null) }) { promise.reject("E_PHONE_CREDENTIAL", it) }
    }
}
