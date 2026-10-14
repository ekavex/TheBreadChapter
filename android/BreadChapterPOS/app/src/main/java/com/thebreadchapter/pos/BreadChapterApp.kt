package com.thebreadchapter.pos

import android.app.Application
import android.bluetooth.BluetoothManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.pinelabs.billing.sdk.PineBillingSdk
import uniffi.pine_billing.AppToAppConfig
import uniffi.pine_billing.LogLevel
import uniffi.pine_billing.SdkConfig
import uniffi.pine_billing.TransportType

class BreadChapterApp : Application() {

    override fun onCreate() {
        super.onCreate()
        AppLogManager.init(this)
        installCrashLogger()
        logStartup()
        LogUploader.start(this)
        tryInitPineSdk()
    }

    // Writes the crash to the log file (uploaded on the next start), then lets
    // Android handle it as before.
    private fun installCrashLogger() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try { AppLogManager.crash(thread, error) } catch (_: Throwable) {}
            previous?.uncaughtException(thread, error)
        }
    }

    // One line with everything that usually explains "printing/payment
    // doesn't work on this phone".
    private fun logStartup() {
        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull()
        val batteryExempt = (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        val bluetoothOn = runCatching { (getSystemService(BLUETOOTH_SERVICE) as BluetoothManager).adapter?.isEnabled }.getOrNull()
        AppLogManager.info(
            "app.start",
            "App $version started on ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}); " +
                "device ${AppLogManager.deviceId}; print bridge ${if (prefs.getBoolean(SettingsActivity.KEY_BRIDGE_ENABLED, false)) "ON" else "off"}, " +
                "station ${prefs.getString(SettingsActivity.KEY_STATION, "all")}; battery optimisation ${if (batteryExempt) "off" else "ON"}; " +
                "Bluetooth ${when (bluetoothOn) { true -> "on"; false -> "OFF"; null -> "unknown" }}; " +
                "server ${prefs.getString(SettingsActivity.KEY_SERVER_URL, "")}",
        )
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
            AppLogManager.info("pine.ready", "Pine Billing SDK ready (AppToApp)")
        } catch (e: Exception) {
            Log.e("PineSDK", "Init failed: ${e.message}")
            AppLogManager.error("pine.init_failed", "Pine SDK init failed: ${e.message}", error = e)
        }
    }
}
