package com.thebreadchapter.pos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
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
        private const val POLL_INTERVAL_MS = 1_200L
        // A cached socket idle longer than this is dropped and reconnected fresh
        // rather than reused - Android doesn't reliably flip isConnected to false
        // when the remote end silently vanishes, so an infrequently-used socket
        // (bills print far less often than KOTs) is the one most likely to be a
        // zombie: reusing it would mean a blocking write that can hang for many
        // seconds before finally failing, which looks identical to "still slow".
        private const val SOCKET_IDLE_TIMEOUT_MS = 30_000L
        // Upper bound on a single write - if it hangs past this, the watchdog
        // force-closes the socket so the caller fails fast and can reconnect,
        // instead of the write blocking indefinitely.
        private const val WRITE_TIMEOUT_MS = 4_000L
        // SPP UUID - standard Serial Port Profile
        private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        var isRunning = false
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    // One phone talks to both printers at once - a Bluetooth SPP link is
    // exclusive per *printer*, not per phone, so this device can hold a socket
    // to the kitchen printer and another to the beverage printer simultaneously.
    // Kept open across jobs instead of reconnect-per-print, since establishing
    // a fresh RFCOMM connection (SDP lookup + channel handshake) typically costs
    // 1–4 seconds - the dominant cost in the old per-job connect/disconnect flow.
    private data class CachedSocket(val socket: BluetoothSocket, var lastUsedAt: Long)
    private val sockets = mutableMapOf<String, CachedSocket>()
    private val socketLock = Any()

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
        closeAllSockets()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Polling loop ──────────────────────────────────────────────────────────

    private suspend fun CoroutineScope.pollLoop() {
        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)

        while (isActive) {
            val serverUrl   = prefs.getString(SettingsActivity.KEY_SERVER_URL, "") ?: ""
            val station     = prefs.getString(SettingsActivity.KEY_STATION, "all") ?: "all"
            val token       = prefs.getString(SettingsActivity.KEY_BRIDGE_TOKEN, "") ?: ""
            
            val kitchenMac  = prefs.getString(SettingsActivity.KEY_KITCHEN_MAC, "") ?: ""
            val beverageMac = prefs.getString(SettingsActivity.KEY_BEVERAGE_MAC, "") ?: ""

            if (serverUrl.isBlank() || token.isBlank() || (kitchenMac.isBlank() && beverageMac.isBlank())) {
                updateNotification("⚙ Settings missing - configure in Settings")
                AppLogManager.log("Bridge waiting for configuration...")
                delay(5000.milliseconds)
                continue
            }

            try {
                AppLogManager.log("Polling for jobs ($station)...")
                val jobs = fetchPendingJobs(serverUrl, station, token)
                if (jobs.length() > 0) {
                    AppLogManager.log("Found ${jobs.length()} pending jobs")
                    updateNotification("Processing ${jobs.length()} job(s)…")
                    for (i in 0 until jobs.length()) {
                        val job = jobs.getJSONObject(i)
                        processJob(job, serverUrl, token, kitchenMac, beverageMac)
                    }
                    updateNotification("✓ Bridge active · listening: $station")
                } else {
                    updateNotification("✓ Bridge active · listening: $station")
                }
            } catch (e: Exception) {
                val msg = "Poll error: ${e.message}"
                Log.e(TAG, msg)
                AppLogManager.log("⚠ $msg")
                updateNotification("⚠ Server unreachable - retrying…")
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
            val code = resp.code
            val body = resp.body?.string() ?: ""
            AppLogManager.log("⚠ API Error $code for $station")
            if (body.isNotBlank()) {
                Log.e(TAG, "Server error body: $body")
                try {
                    val json = JSONObject(body)
                    val err = json.optString("error", "Unknown error")
                    AppLogManager.log("Server message: $err")
                } catch (_: Exception) {
                    AppLogManager.log("Raw error: ${body.take(100)}")
                }
            }
            throw IOException("Server returned $code")
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

    private fun processJob(
        job: JSONObject,
        serverUrl: String,
        token: String,
        kitchenMac: String,
        beverageMac: String,
    ) {
        val jobId        = job.getString("id")
        val tableLabel   = job.getString("tableLabel")
        val orderId      = job.getString("orderId")
        val station      = job.getString("station")
        val jobType      = job.optString("jobType", "kot")
        val itemsJson    = job.getJSONArray("items")
        val customerNote = if (job.has("customerNote") && !job.isNull("customerNote")) job.getString("customerNote") else null
        val takenBy = if (job.has("takenBy") && !job.isNull("takenBy")) job.getString("takenBy") else null

        val targetMac = when (station.lowercase()) {
            "kitchen" -> kitchenMac
            "beverage_counter", "beverage", "beverages" -> beverageMac
            else -> {
                AppLogManager.log("⚠ Job $jobId station '$station' unknown, skipping")
                return
            }
        }

        if (targetMac.isBlank()) {
            AppLogManager.log("⚠ Job $jobId: No MAC for station '$station', skipped")
            return
        }

        try {
            AppLogManager.log("Printing $jobId ($station / $jobType) to $targetMac")

            val payload = if (jobType == "bill_qr") {
                val upiUrl      = job.optString("upiUrl", "")
                val amountPaisa = job.optLong("amountPaisa", 0L)
                val items = (0 until itemsJson.length()).map { i ->
                    val obj = itemsJson.getJSONObject(i)
                    mapOf(
                        "name"     to obj.getString("name"),
                        "quantity" to obj.getInt("quantity"),
                        "subtotal" to obj.optInt("subtotal", 0),
                    )
                }
                EscPosHelper.buildBillWithQr(tableLabel, orderId, items, amountPaisa, upiUrl, customerNote)
            } else {
                val items = (0 until itemsJson.length()).map { i ->
                    val obj = itemsJson.getJSONObject(i)
                    val addonArray = obj.optJSONArray("addons")
                    val addonNames = if (addonArray != null) {
                        (0 until addonArray.length()).map { j -> addonArray.getString(j) }
                    } else emptyList()
                    mapOf(
                        "name"     to obj.getString("name"),
                        "quantity" to obj.getInt("quantity"),
                        "addons"   to addonNames,
                    )
                }
                EscPosHelper.buildKotTicket(tableLabel, orderId, station, items, customerNote, takenBy)
            }

            sendViaBluetooth(targetMac, payload)
            markJobDone(serverUrl, jobId, token)
            AppLogManager.log("✓ Printed $jobId for table $tableLabel")
        } catch (e: Exception) {
            val err = "Failed job $jobId: ${e.message}"
            Log.e(TAG, err)
            AppLogManager.log("✖ $err")
        }
    }

    // ── Bluetooth ─────────────────────────────────────────────────────────────
    // Sockets are cached per MAC and reused across jobs. A job only pays the
    // Bluetooth connect cost the *first* time it prints to a given printer (or
    // after a real disconnect) - every job after that just writes to an
    // already-open stream, which is milliseconds instead of seconds.

    private fun sendViaBluetooth(mac: String, payload: ByteArray) {
        val t0 = System.currentTimeMillis()
        val socket = getOrConnectSocket(mac)
        val tConnected = System.currentTimeMillis()
        try {
            writeWithTimeout(socket, payload)
            Thread.sleep(500) // let printer buffer drain
        } catch (e: Exception) {
            // Write failed (or hung past the watchdog timeout) - the connection
            // is dead (printer rebooted, walked out of range, silently dropped
            // while idle, etc). Drop it and retry once with a fresh connection.
            AppLogManager.log("⚠ Write to $mac failed (${e.message}), reconnecting")
            closeSocket(mac)
            val fresh = getOrConnectSocket(mac)
            writeWithTimeout(fresh, payload)
            Thread.sleep(500)
        } finally {
            val tDone = System.currentTimeMillis()
            AppLogManager.log(
                "Print to $mac: connect=${tConnected - t0}ms write+drain=${tDone - tConnected}ms"
            )
        }
    }

    // A blocking OutputStream.write() to a dead BluetoothSocket can hang far
    // longer than any sane print job should take, since classic Bluetooth has
    // no fast keepalive to surface a silently-vanished remote end. Run the
    // write on this thread but arm a watchdog that force-closes the socket
    // if it doesn't finish in time - closing from another thread reliably
    // unblocks a stuck read/write with an IOException, turning an indefinite
    // hang into a bounded failure the caller can reconnect and retry from.
    private fun writeWithTimeout(socket: BluetoothSocket, payload: ByteArray) {
        val watchdog = Thread {
            try {
                Thread.sleep(WRITE_TIMEOUT_MS)
                AppLogManager.log("⚠ Write watchdog fired - forcing socket closed")
                try { socket.close() } catch (_: Exception) {}
            } catch (_: InterruptedException) {
                // Write finished in time - nothing to do.
            }
        }
        watchdog.start()
        try {
            socket.outputStream.write(payload)
            socket.outputStream.flush()
        } finally {
            watchdog.interrupt()
        }
    }

    private fun getOrConnectSocket(mac: String): BluetoothSocket {
        synchronized(socketLock) {
            sockets[mac]?.let { cached ->
                val idleMs = System.currentTimeMillis() - cached.lastUsedAt
                if (cached.socket.isConnected && idleMs < SOCKET_IDLE_TIMEOUT_MS) {
                    cached.lastUsedAt = System.currentTimeMillis()
                    return cached.socket
                }
                closeSocketLocked(mac)
            }

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
                    as BluetoothSocket
            }

            @Suppress("MissingPermission")
            adapter.cancelDiscovery()

            @Suppress("MissingPermission")
            socket.connect()
            sockets[mac] = CachedSocket(socket, System.currentTimeMillis())
            AppLogManager.log("Connected to printer $mac")
            return socket
        }
    }

    private fun closeSocket(mac: String) {
        synchronized(socketLock) { closeSocketLocked(mac) }
    }

    private fun closeSocketLocked(mac: String) {
        sockets.remove(mac)?.let {
            try { it.socket.close() } catch (_: Exception) {}
        }
    }

    private fun closeAllSockets() {
        synchronized(socketLock) {
            sockets.keys.toList().forEach { closeSocketLocked(it) }
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
