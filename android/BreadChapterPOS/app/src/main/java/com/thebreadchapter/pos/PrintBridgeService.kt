package com.thebreadchapter.pos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import android.annotation.SuppressLint
import kotlinx.coroutines.*
import kotlin.time.Duration.Companion.milliseconds
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class PrintBridgeService : Service() {

    companion object {
        private const val TAG = "PrintBridge"
        private const val CHANNEL_ID = "print_bridge"
        private const val NOTIF_ID = 1001
        private const val POLL_INTERVAL_MS = 3_000L
        // SPP UUID — standard Serial Port Profile
        private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        var isRunning = false
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification("Starting print bridge…"))
        isRunning = true
        scope.launch { pollLoop() }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Polling loop ──────────────────────────────────────────────────────────

    private suspend fun CoroutineScope.pollLoop() {
        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)

        while (isActive) {
            val serverUrl   = prefs.getString(SettingsActivity.KEY_SERVER_URL, "") ?: ""
            val station     = prefs.getString(SettingsActivity.KEY_STATION, "kitchen") ?: "kitchen"
            val printerMac  = prefs.getString(SettingsActivity.KEY_PRINTER_MAC, "") ?: ""
            val token       = prefs.getString(SettingsActivity.KEY_BRIDGE_TOKEN, "") ?: ""

            if (serverUrl.isBlank() || printerMac.isBlank() || token.isBlank()) {
                updateNotification("⚙ Settings not configured — open Settings")
                delay(5000.milliseconds)
                continue
            }

            try {
                val jobs = fetchPendingJobs(serverUrl, station, token)
                if (jobs.length() > 0) {
                    updateNotification("Printing ${jobs.length()} job(s)…")
                    for (i in 0 until jobs.length()) {
                        val job = jobs.getJSONObject(i)
                        processJob(job, printerMac, serverUrl, token)
                    }
                    updateNotification("✓ Bridge active · station: $station")
                } else {
                    updateNotification("✓ Bridge active · station: $station")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Poll error: ${e.message}")
                updateNotification("⚠ Server unreachable — retrying…")
            }

            delay(POLL_INTERVAL_MS.milliseconds)
        }
    }

    // ── API calls ─────────────────────────────────────────────────────────────

    private fun fetchPendingJobs(serverUrl: String, station: String, token: String): JSONArray {
        val url = "$serverUrl/api/pos/print-jobs?station=$station&token=$token"
        val req = Request.Builder().url(url).get().build()
        val resp = http.newCall(req).execute()
        if (!resp.isSuccessful) {
            throw IOException("Server returned ${resp.code}")
        }
        val body = resp.body?.string() ?: "[]"
        val json = JSONObject(body)
        return json.optJSONArray("data") ?: JSONArray()
    }

    private fun markJobDone(serverUrl: String, jobId: String, token: String) {
        val url = "$serverUrl/api/pos/print-jobs/$jobId?token=$token"
        val body = "{}".toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).patch(body).build()
        http.newCall(req).execute().close()
    }

    // ── Print one job ─────────────────────────────────────────────────────────

    private fun processJob(job: JSONObject, printerMac: String, serverUrl: String, token: String) {
        val jobId      = job.getString("id")
        val tableLabel = job.getString("tableLabel")
        val orderId    = job.getString("orderId")
        val station    = job.getString("station")
        val itemsJson  = job.getJSONArray("items")

        val items = (0 until itemsJson.length()).map { i ->
            val obj = itemsJson.getJSONObject(i)
            mapOf("name" to obj.getString("name"), "quantity" to obj.getInt("quantity"))
        }

        try {
            val payload = EscPosHelper.buildKotTicket(tableLabel, orderId, station, items)
            sendViaBluetooth(printerMac, payload)
            markJobDone(serverUrl, jobId, token)
            Log.i(TAG, "Printed job $jobId for table $tableLabel")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to print job $jobId: ${e.message}")
            // Job stays 'queued' — will be retried on next poll
        }
    }

    // ── Bluetooth ─────────────────────────────────────────────────────────────

    private fun sendViaBluetooth(mac: String, payload: ByteArray) {
        val bm = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        val adapter: BluetoothAdapter = bm.adapter
            ?: throw IOException("Bluetooth not available on this device")

        if (!adapter.isEnabled) throw IOException("Bluetooth is disabled")

        @Suppress("MissingPermission")
        val device = adapter.getRemoteDevice(mac)

        // Try SPP UUID first; fall back to reflection channel 1 for older printers
        val socket = try {
            @Suppress("MissingPermission")
            device.createRfcommSocketToServiceRecord(SPP_UUID)
        } catch (_: Exception) {
            @Suppress("MissingPermission")
            device.javaClass.getMethod("createRfcommSocket", Int::class.java).invoke(device, 1)
                as android.bluetooth.BluetoothSocket
        }

        @Suppress("MissingPermission")
        adapter.cancelDiscovery()

        @Suppress("MissingPermission")
        socket.connect()
        socket.use {
            it.outputStream.write(payload)
            it.outputStream.flush()
            Thread.sleep(500) // let printer buffer drain
        }
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Print Bridge",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "KOT Bluetooth print bridge status" }
            (getSystemService(NotificationManager::class.java)).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String): Notification {
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Bread Chapter POS")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setContentIntent(tapIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    @SuppressLint("MissingPermission", "NotificationPermission")
    private fun updateNotification(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }
}
