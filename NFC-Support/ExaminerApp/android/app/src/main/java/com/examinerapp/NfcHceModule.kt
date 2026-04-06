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
        ExamHceService.isActive = true
    }

    @ReactMethod
    fun clearExamData() {
        ExamHceService.examDataJson = ""
        ExamHceService.isActive = false
    }
}
