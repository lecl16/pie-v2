package com.examinerapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native NativeModule that stores the plain exam payload used by HCE.
 */
class NfcHceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NfcHceModule"

    @ReactMethod
    fun setExamData(jsonString: String) {
        ExamHceService.examDataJson = jsonString
        ExamHceService.secureProvisioningEnabled = false
        ExamHceService.securePayloadJson = ""
        ExamHceService.sharedSecretB64u = ""
        ExamHceService.isActive = true
    }

    @ReactMethod
    fun setSecureProvisioning(payloadJson: String, sharedSecretBase64Url: String) {
        ExamHceService.secureProvisioningEnabled = true
        ExamHceService.securePayloadJson = payloadJson
        ExamHceService.sharedSecretB64u = sharedSecretBase64Url
        ExamHceService.examDataJson = ""
        ExamHceService.isActive = true
    }

    @ReactMethod
    fun clearExamData() {
        ExamHceService.examDataJson = ""
        ExamHceService.secureProvisioningEnabled = false
        ExamHceService.securePayloadJson = ""
        ExamHceService.sharedSecretB64u = ""
        ExamHceService.isActive = false
    }
}
