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
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
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
import java.util.concurrent.ConcurrentHashMap
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
        // A write is only treated as dead when the printer accepts *nothing* for
        // this long (see StallGuardedWriter). The old fixed 4s limit on the whole
        // write cut off logo bills (~8 KB, which a Bluetooth printer takes in only
        // as fast as it prints) and then resent them - duplicate bills.
        private const val STALL_TIMEOUT_MS = 8_000L
        // BluetoothSocket.connect() has no timeout of its own; an unreachable or
        // switched-off printer could otherwise hang the bridge for a long time.
        private const val CONNECT_TIMEOUT_MS = 8_000L
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
    private val sockets = ConcurrentHashMap<String, CachedSocket>()
    // One lock per printer: connecting to (or waiting on) the kitchen printer
    // must never hold up a bill on the barista printer, and vice versa.
    private val printerLocks = ConcurrentHashMap<String, Any>()
    private fun lockFor(mac: String): Any = printerLocks.getOrPut(mac) { Any() }

    // Only ever one polling loop per service. onStartCommand runs again every
    // time the app is opened (MainActivity starts the service on each launch);
    // before this guard each launch added another loop, so a phone that had been
    // reopened a few times was several bridges at once, all claiming jobs and
    // writing to the same printer sockets concurrently.
    private var pollJob: Job? = null

    // While the server is unreachable every poll fails; log that once a
    // minute (or when the error changes) instead of every 1.2 seconds.
    private var lastPollError: String? = null
    private var lastPollErrorLoggedAt = 0L

    // A foreground service keeps the process alive but does NOT keep the CPU or
    // Wi-Fi awake once the screen is off - the poll loop would simply stop until
    // something woke the phone, which is how bills sat unprinted for minutes.
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    // The printer took part of the job before the connection dropped, so some
    // of it may already be on paper.
    private class PartialPrintException(val bytesSent: Int, val totalBytes: Int) :
        IOException("connection dropped after $bytesSent of $totalBytes bytes")

    // Decoded once and reused for every bill print - bills print far less often
    // than KOTs, so the decode cost per job is a non-issue either way.
    private val logoBitmap: android.graphics.Bitmap? by lazy {
        try {
            android.graphics.BitmapFactory.decodeResource(resources, R.drawable.logo_receipt)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load receipt logo: ${e.message}")
            null
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification("Starting print bridge…"))
        isRunning = true
        acquireAwakeLocks()
        if (pollJob?.isActive != true) {
            pollJob = scope.launch { pollLoop() }
        } else {
            AppLogManager.log("Bridge already running - not starting a second poll loop")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        scope.cancel()
        closeAllSockets()
        releaseAwakeLocks()
        super.onDestroy()
    }

    @SuppressLint("WakelockTimeout") // held for exactly as long as the bridge runs
    private fun acquireAwakeLocks() {
        if (wakeLock == null) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BreadChapterPOS:PrintBridge").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        if (wifiLock == null) {
            val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION") // HIGH_PERF is the mode that keeps Wi-Fi fully up on all supported versions
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "BreadChapterPOS:PrintBridge").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        AppLogManager.log(
            if (pm.isIgnoringBatteryOptimizations(packageName)) "Battery optimisation: off for this app ✓"
            else "⚠ Battery optimisation is ON for this app - the phone may still pause printing when idle"
        )
    }

    private fun releaseAwakeLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        wifiLock = null
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
                AppLogManager.debug("bridge.not_configured", "Bridge waiting for configuration (server URL, token or printer missing)")
                delay(5000.milliseconds)
                continue
            }

            try {
                AppLogManager.debug("bridge.poll", "Polling for jobs ($station)...")
                val jobs = fetchPendingJobs(serverUrl, station, token)
                if (lastPollError != null) {
                    AppLogManager.info("bridge.poll_recovered", "Server reachable again")
                    lastPollError = null
                }
                if (jobs.length() > 0) {
                    AppLogManager.info("bridge.jobs_received", "Received ${jobs.length()} print job(s)")
                    updateNotification("Processing ${jobs.length()} job(s)…")
                    processJobsPerPrinter(jobs, serverUrl, token, kitchenMac, beverageMac)
                    updateNotification("✓ Bridge active · listening: $station")
                } else {
                    updateNotification("✓ Bridge active · listening: $station")
                }
            } catch (e: Exception) {
                val msg = "Poll error: ${e.message}"
                Log.e(TAG, msg)
                val now = System.currentTimeMillis()
                if (msg != lastPollError || now - lastPollErrorLoggedAt > 60_000) {
                    AppLogManager.warn("bridge.poll_error", msg)
                    lastPollError = msg
                    lastPollErrorLoggedAt = now
                } else {
                    AppLogManager.debug("bridge.poll_error", msg)
                }
                updateNotification("⚠ Server unreachable - retrying…")
            }

            delay(POLL_INTERVAL_MS.milliseconds)
        }
    }

    // ── API calls ─────────────────────────────────────────────────────────────

    private fun fetchPendingJobs(serverUrl: String, station: String, token: String): JSONArray {
        // caps=payload: this bridge prints server-rendered tickets (the layout
        // edited in the dashboard's Print Layout page) and test prints.
        val url = "$serverUrl/api/pos/print-jobs?station=$station&token=$token&caps=payload"
        val req = Request.Builder().url(url).get().build()
        val resp = http.newCall(req).execute()
        
        if (!resp.isSuccessful) {
            val code = resp.code
            val body = resp.body?.string() ?: ""
            Log.e(TAG, "Server error body: $body")
            // The poll loop logs this (throttled) with the server's message.
            val serverMessage = runCatching { JSONObject(body).optString("error", "") }.getOrNull()
                ?.takeIf { it.isNotBlank() } ?: body.take(100)
            throw IOException("Server returned $code${if (serverMessage.isNotBlank()) ": $serverMessage" else ""}")
        }
        
        val body = resp.body?.string() ?: "[]"
        val json = JSONObject(body)
        return json.optJSONArray("data") ?: JSONArray()
    }

    // The print has already physically happened by the time this is called -
    // losing this confirmation (unlike losing the original job fetch) means the
    // server's stale-reclaim will hand the same ticket out again in 45s and
    // cause a genuine second physical print. A transient network blip here is
    // worth retrying hard before letting that happen.
    private val CONFIRM_BACKOFF_MS = longArrayOf(500, 1500, 3000)

    // detail != null: confirmed even though the connection dropped part-way, so
    // the server records it on the admin Printing page instead of reprinting.
    private fun markJobDone(serverUrl: String, jobId: String, token: String, detail: String? = null) {
        val url = "$serverUrl/api/pos/print-jobs/$jobId?token=$token"
        val json = JSONObject().apply { if (detail != null) { put("outcome", "partial"); put("detail", detail) } }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).patch(body).build()

        var lastError: Exception? = null
        for (attempt in 0..CONFIRM_BACKOFF_MS.size) {
            try {
                http.newCall(req).execute().use { resp ->
                    // 404 means the job is already marked done - e.g. a previous
                    // attempt's PATCH landed but its response was lost. Treat
                    // that as success rather than retrying forever.
                    if (resp.isSuccessful || resp.code == 404) return
                    lastError = IOException("Confirm returned ${resp.code}")
                }
            } catch (e: Exception) {
                lastError = e
            }
            if (attempt < CONFIRM_BACKOFF_MS.size) {
                AppLogManager.warn("print.confirm_retry", "Confirm for job $jobId failed (${lastError?.message}), retrying…")
                Thread.sleep(CONFIRM_BACKOFF_MS[attempt])
            }
        }
        throw lastError ?: IOException("Confirm failed for unknown reason")
    }

    // ── Print jobs ────────────────────────────────────────────────────────────

    private fun targetMacFor(station: String, kitchenMac: String, beverageMac: String): String? =
        when (station.lowercase()) {
            "kitchen" -> kitchenMac
            "beverage_counter", "beverage", "beverages" -> beverageMac
            else -> null
        }

    // Each printer's jobs run in order, but the two printers run side by side,
    // so a switched-off kitchen printer can't keep bills waiting (and vice versa).
    private suspend fun processJobsPerPrinter(
        jobs: JSONArray,
        serverUrl: String,
        token: String,
        kitchenMac: String,
        beverageMac: String,
    ) = coroutineScope {
        val byPrinter = (0 until jobs.length())
            .map { jobs.getJSONObject(it) }
            .groupBy { targetMacFor(it.optString("station"), kitchenMac, beverageMac) ?: "" }

        byPrinter.map { (mac, printerJobs) ->
            async(Dispatchers.IO) {
                for (job in printerJobs) {
                    val printerReachable = processJob(job, serverUrl, token, kitchenMac, beverageMac)
                    if (!printerReachable) {
                        // Leave the rest unconfirmed; the server hands them out again
                        // shortly instead of every one waiting on a dead connection.
                        AppLogManager.log("⚠ Printer $mac unreachable - ${printerJobs.size - printerJobs.indexOf(job) - 1} more job(s) for it will be retried")
                        break
                    }
                }
            }
        }.awaitAll()
    }

    /** Returns false when the printer couldn't be reached at all. */
    private fun processJob(
        job: JSONObject,
        serverUrl: String,
        token: String,
        kitchenMac: String,
        beverageMac: String,
    ): Boolean {
        val jobId        = job.getString("id")
        val tableLabel   = job.optString("tableLabel", "")
        val station      = job.getString("station")
        val jobType      = job.optString("jobType", "kot")

        val logOrderId = job.optStringOrNull("orderId")
        val what = when (jobType) {
            "bill_qr" -> "Bill for table $tableLabel (job $jobId)"
            "test" -> "Test print from Print Layout (job $jobId)"
            else -> "KOT for table $tableLabel (job $jobId)"
        }

        val targetMac = targetMacFor(station, kitchenMac, beverageMac)
        if (targetMac == null) {
            AppLogManager.error("print.unknown_station", "$what: station '$station' unknown, skipped", logOrderId)
            return true
        }

        if (targetMac.isBlank()) {
            AppLogManager.error("print.no_printer", "$what: no printer set for '$station' in Settings, skipped", logOrderId)
            return true
        }

        try {
            AppLogManager.info("print.start", "Printing $what on $station ($targetMac)", logOrderId)

            // Ticket already rendered by the server with the saved print layout.
            // Older servers don't send it; then the built-in layout below is used.
            val serverPayload = job.optStringOrNull("payloadBase64")?.let { Base64.decode(it, Base64.DEFAULT) }
            val payload = if (serverPayload != null) {
                serverPayload
            } else if (jobType == "bill_qr") {
                val orderId       = job.getString("orderId")
                val itemsJson     = job.getJSONArray("items")
                val customerNote  = job.optStringOrNull("customerNote")
                val orderNumber   = job.optStringOrNull("orderNumber")
                val upiUrl        = job.optString("upiUrl", "")
                val amountPaisa   = job.optLong("amountPaisa", 0L)
                val subtotalPaisa = job.optLong("subtotalPaisa", 0L)
                val taxAmountPaisa = job.optLong("taxAmountPaisa", 0L)
                val items = (0 until itemsJson.length()).map { i ->
                    val obj = itemsJson.getJSONObject(i)
                    val addonArray = obj.optJSONArray("addons")
                    val addonNames = if (addonArray != null) {
                        (0 until addonArray.length()).map { j -> addonArray.getString(j) }
                    } else emptyList()
                    mapOf(
                        "name"     to obj.getString("name"),
                        "quantity" to obj.getInt("quantity"),
                        "subtotal" to obj.optInt("subtotal", 0),
                        "addons"   to addonNames,
                    )
                }
                EscPosHelper.buildBillWithQr(
                    tableLabel, orderId, items, amountPaisa, upiUrl, customerNote, logoBitmap,
                    subtotalPaisa = subtotalPaisa, taxAmountPaisa = taxAmountPaisa,
                    billNo      = job.optStringOrNull("billNumber"),
                    orderNumber = orderNumber,
                    staffName   = job.optStringOrNull("staffName"),
                    fssaiNumber = job.optStringOrNull("fssaiNumber"),
                    paid        = job.optBoolean("paid", false),
                    paymentMode = job.optStringOrNull("paymentMode"),
                    paymentRef  = job.optStringOrNull("paymentRef"),
                )
            } else {
                val orderId      = job.getString("orderId")
                val itemsJson    = job.getJSONArray("items")
                val customerNote = job.optStringOrNull("customerNote")
                val takenBy      = job.optStringOrNull("takenBy")
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

            try {
                sendViaBluetooth(targetMac, payload)
            } catch (e: PartialPrintException) {
                if (jobType == "bill_qr") {
                    // Part of the bill may already be on paper. Resending risks a
                    // second bill, so confirm it and let staff reprint if it came
                    // out incomplete (it's flagged on the admin Printing page).
                    AppLogManager.warn("print.partial", "$what: ${e.message} - NOT resending; reprint if the bill is incomplete", logOrderId)
                    markJobDone(serverUrl, jobId, token, detail = "Connection dropped after ${e.bytesSent} of ${e.totalBytes} bytes - check the printout and reprint if incomplete")
                    return true
                }
                // A KOT is better printed twice than missed: leave it unconfirmed
                // so the server hands it out again.
                throw e
            }
            markJobDone(serverUrl, jobId, token)
            AppLogManager.info("print.done", "Printed $what", logOrderId)
            return true
        } catch (e: PrinterUnreachableException) {
            AppLogManager.error("print.printer_unreachable", "$what not printed: ${e.message}", logOrderId)
            return false
        } catch (e: Exception) {
            AppLogManager.error("print.failed", "$what not printed: ${e.message}", logOrderId, e)
            return true
        }
    }

    private class PrinterUnreachableException(mac: String, cause: Throwable) :
        IOException("printer $mac unreachable: ${cause.message}", cause)

    // Optional string field: null when missing, JSON null or blank.
    private fun JSONObject.optStringOrNull(key: String): String? =
        if (has(key) && !isNull(key)) getString(key).takeIf { it.isNotBlank() } else null

    // ── Bluetooth ─────────────────────────────────────────────────────────────
    // Sockets are cached per MAC and reused across jobs. A job only pays the
    // Bluetooth connect cost the *first* time it prints to a given printer (or
    // after a real disconnect) - every job after that just writes to an
    // already-open stream, which is milliseconds instead of seconds.

    // One job at a time per printer (the per-printer lock also guards that
    // printer's socket). Throws:
    //  - PrinterUnreachableException: couldn't connect, nothing was printed;
    //  - PartialPrintException: the connection dropped after the printer had
    //    taken some of the job, so part of it may already be on paper.
    private fun sendViaBluetooth(mac: String, payload: ByteArray) {
        synchronized(lockFor(mac)) {
            val t0 = System.currentTimeMillis()
            val socket = connectOrThrow(mac)
            val tConnected = System.currentTimeMillis()
            try {
                try {
                    writeGuarded(mac, socket, payload)
                } catch (e: StallGuardedWriter.WriteFailedException) {
                    closeSocket(mac)
                    if (e.bytesSent > 0) throw PartialPrintException(e.bytesSent, e.totalBytes)
                    // Nothing reached the printer - the cached connection was
                    // already dead. Resending can't duplicate anything.
                    AppLogManager.log("⚠ Write to $mac failed before any data was sent (${e.cause?.message}), reconnecting")
                    val fresh = connectOrThrow(mac)
                    try {
                        writeGuarded(mac, fresh, payload)
                    } catch (e2: StallGuardedWriter.WriteFailedException) {
                        closeSocket(mac)
                        if (e2.bytesSent > 0) throw PartialPrintException(e2.bytesSent, e2.totalBytes)
                        throw PrinterUnreachableException(mac, e2)
                    }
                }
                Thread.sleep(500) // let printer buffer drain
            } finally {
                val tDone = System.currentTimeMillis()
                AppLogManager.log(
                    "Print to $mac: ${payload.size} bytes, connect=${tConnected - t0}ms write+drain=${tDone - tConnected}ms"
                )
            }
        }
    }

    private fun writeGuarded(mac: String, socket: BluetoothSocket, payload: ByteArray) {
        StallGuardedWriter.write(
            out = socket.outputStream,
            payload = payload,
            stallTimeoutMs = STALL_TIMEOUT_MS,
            abort = {
                AppLogManager.log("⚠ Printer $mac accepted no data for ${STALL_TIMEOUT_MS / 1000}s - closing connection")
                try { socket.close() } catch (_: Exception) {}
            },
        )
        sockets[mac]?.lastUsedAt = System.currentTimeMillis()
    }

    private fun connectOrThrow(mac: String): BluetoothSocket =
        try {
            getOrConnectSocket(mac)
        } catch (e: Exception) {
            closeSocket(mac)
            throw PrinterUnreachableException(mac, e)
        }

    private fun getOrConnectSocket(mac: String): BluetoothSocket {
        synchronized(lockFor(mac)) {
            sockets[mac]?.let { cached ->
                val idleMs = System.currentTimeMillis() - cached.lastUsedAt
                if (cached.socket.isConnected && idleMs < SOCKET_IDLE_TIMEOUT_MS) {
                    cached.lastUsedAt = System.currentTimeMillis()
                    return cached.socket
                }
                closeSocket(mac)
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

            connectWithTimeout(mac, socket)
            sockets[mac] = CachedSocket(socket, System.currentTimeMillis())
            AppLogManager.log("Connected to printer $mac")
            return socket
        }
    }

    // Closing the socket from another thread is the only way to abort a
    // blocked BluetoothSocket.connect(); it then throws an IOException.
    private fun connectWithTimeout(mac: String, socket: BluetoothSocket) {
        val watchdog = Thread {
            try {
                Thread.sleep(CONNECT_TIMEOUT_MS)
                AppLogManager.log("⚠ Connecting to printer $mac took over ${CONNECT_TIMEOUT_MS / 1000}s - giving up")
                try { socket.close() } catch (_: Exception) {}
            } catch (_: InterruptedException) {
                // Connected (or failed) in time.
            }
        }.apply { isDaemon = true }
        watchdog.start()
        try {
            @Suppress("MissingPermission")
            socket.connect()
        } finally {
            watchdog.interrupt()
        }
    }

    private fun closeSocket(mac: String) {
        sockets.remove(mac)?.let {
            try { it.socket.close() } catch (_: Exception) {}
        }
    }

    private fun closeAllSockets() {
        sockets.keys.toList().forEach { closeSocket(it) }
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
