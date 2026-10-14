package com.thebreadchapter.pos

import android.content.Context
import android.os.Build
import android.util.Log
import android.webkit.CookieManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Sends AppLogManager's queued entries to POST /api/logs/device, where they
 * land in the server's app_logs table for developers. Runs for the whole app
 * process on every phone (not just the print bridge). Entries are removed
 * from the phone only after the server confirms it stored them, so nothing is
 * lost while the phone is offline; failures back off up to 5 minutes.
 */
object LogUploader {

    private const val TAG = "LogUploader"
    private const val INTERVAL_MS = 30_000L
    private const val MAX_BACKOFF_MS = 5 * 60_000L
    private const val BATCH_SIZE = 300

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private var started = false

    fun start(context: Context) {
        if (started) return
        started = true
        val app = context.applicationContext
        scope.launch {
            delay(5_000) // let the app finish starting
            var wait = INTERVAL_MS
            while (isActive) {
                wait = try {
                    uploadAll(app)
                    INTERVAL_MS
                } catch (e: Exception) {
                    Log.w(TAG, "Log upload failed: ${e.message}")
                    (wait * 2).coerceAtMost(MAX_BACKOFF_MS)
                }
                delay(wait)
            }
        }
    }

    private fun uploadAll(context: Context) {
        val prefs = context.getSharedPreferences(SettingsActivity.PREFS, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(SettingsActivity.KEY_SERVER_URL, "").orEmpty().trimEnd('/')
        if (serverUrl.isBlank()) return
        val token = prefs.getString(SettingsActivity.KEY_BRIDGE_TOKEN, "").orEmpty().trim()
        val appVersion = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "unknown"

        while (true) {
            val lines = AppLogManager.peekPending(BATCH_SIZE)
            if (lines.isEmpty()) return

            val entries = JSONArray()
            for (line in lines) runCatching { entries.put(JSONObject(line)) }
            val body = JSONObject()
                .put("deviceId", AppLogManager.deviceId)
                .put("appVersion", appVersion)
                .put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
                .put("entries", entries)
                .toString()

            val request = Request.Builder()
                .url("$serverUrl/api/logs/device")
                .post(body.toRequestBody("application/json".toMediaType()))
                .apply {
                    // The bridge phone has the token; staff phones use the
                    // WebView's logged-in session instead.
                    if (token.isNotBlank()) header("x-print-bridge-token", token)
                    CookieManager.getInstance().getCookie(serverUrl)?.let { header("Cookie", it) }
                }
                .build()

            http.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw IllegalStateException("server returned ${resp.code}")
            }
            AppLogManager.removePending(lines.size)
            if (lines.size < BATCH_SIZE) return
        }
    }
}
