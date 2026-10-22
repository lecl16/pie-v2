package com.examinerapp

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native NativeModule that holds what the HCE service delivers in a
 * tap: a session provisioning payload or a new device identity, both sent
 * encrypted to the reader (ExamHceService.kt).
 */
class NfcHceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NfcHceModule"

    /**
     * A fresh 32-byte session secret, base64url — generated here rather than
     * in JS because React Native has no built-in CSPRNG. The app registers it
     * with the server and then hands it back via setSecureProvisioning(); see
     * pie-api-main/docs/examiner-trusted-node-provisioning.md section 2.
     */
    @ReactMethod
    fun generateSecret(promise: Promise) {
        promise.resolve(
            Base64.encodeToString(
                NfcCrypto.randomBytes(32),
                Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING,
            ),
        )
    }

    @ReactMethod
    fun setSecureProvisioning(payloadJson: String, sharedSecretBase64Url: String) {
        ExamHceService.secureProvisioningEnabled = true
        ExamHceService.securePayloadJson = payloadJson
        ExamHceService.sharedSecretB64u = sharedSecretBase64Url
        ExamHceService.pendingDeviceIdentityJson = ""
        ExamHceService.isActive = true
    }

    /**
     * Holds a freshly created device identity in memory, ready to be
     * delivered on the next INS_GET_DEVICE_IDENTITY tap — see
     * pie-api-main/docs/device-identity-nfc-bootstrap.md section 2.
     * `identityJson` is `{"deviceId": <int>, "apiKey": "...", "apiBaseUrl": "..."}`.
     */
    @ReactMethod
    fun setPendingDeviceIdentity(identityJson: String) {
        ExamHceService.pendingDeviceIdentityJson = identityJson
        ExamHceService.secureProvisioningEnabled = false
        ExamHceService.securePayloadJson = ""
        ExamHceService.sharedSecretB64u = ""
        ExamHceService.isActive = true
    }

    /** Cancels a held device identity before it's delivered (e.g. the
     * examiner backs out of the "provision new device" flow). */
    @ReactMethod
    fun clearPendingDeviceIdentity() {
        ExamHceService.pendingDeviceIdentityJson = ""
    }

    @ReactMethod
    fun clearProvisioning() {
        ExamHceService.secureProvisioningEnabled = false
        ExamHceService.securePayloadJson = ""
        ExamHceService.sharedSecretB64u = ""
        ExamHceService.pendingDeviceIdentityJson = ""
        ExamHceService.isActive = false
    }
}
