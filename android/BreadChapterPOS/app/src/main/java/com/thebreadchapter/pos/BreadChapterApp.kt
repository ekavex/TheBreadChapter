package com.thebreadchapter.pos

import android.app.Application
import android.util.Log
import com.pinelabs.billing.sdk.PineBillingSdk
import uniffi.pine_billing.AppToAppConfig
import uniffi.pine_billing.LogLevel
import uniffi.pine_billing.SdkConfig
import uniffi.pine_billing.TransportType

class BreadChapterApp : Application() {

    override fun onCreate() {
        super.onCreate()
        tryInitPineSdk()
    }

    fun tryInitPineSdk() {
        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)
        val appId = prefs.getString(SettingsActivity.KEY_PINE_APP_ID, "").orEmpty().trim()
        if (appId.isBlank()) {
            Log.i("PineSDK", "No Application ID set - SDK not initialised yet")
            return
        }
        if (PineBillingSdk.isInitialized()) {
            Log.i("PineSDK", "Already initialised")
            return
        }
        try {
            val config = SdkConfig(
                logLevel = LogLevel.INFO,
                transport = TransportType.APP_TO_APP,
                appToApp = AppToAppConfig(applicationId = appId),
                cloud = null,
                serial = null,
                bluetooth = null,
                simulator = null,
            )
            PineBillingSdk.init(context = this, config = config, logger = null)
            Log.i("PineSDK", "Initialised with appId=$appId")
            AppLogManager.log("Pine Billing SDK ready (AppToApp, appId=$appId)")
        } catch (e: Exception) {
            Log.e("PineSDK", "Init failed: ${e.message}")
            AppLogManager.log("Pine SDK init failed: ${e.message}")
        }
    }
}
