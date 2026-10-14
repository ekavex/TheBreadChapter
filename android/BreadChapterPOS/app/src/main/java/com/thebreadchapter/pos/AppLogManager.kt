package com.thebreadchapter.pos

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

/**
 * App-wide log. Every entry goes to three places:
 *  - memory, for the on-phone log screen (LogActivity);
 *  - history.log in the app's files, so the log screen survives restarts;
 *  - pending.jsonl, the upload queue LogUploader sends to the server's
 *    app_logs table (removed only once the server confirms it stored them).
 *
 * DEBUG entries (e.g. every poll) stay in memory only, so they can't push the
 * useful lines out of the files or flood the server.
 */
object AppLogManager {

    enum class Level(val tag: String) { DEBUG("debug"), INFO("info"), WARN("warn"), ERROR("error") }

    private const val TAG = "AppLog"
    private const val MAX_MEMORY = 300
    private const val MAX_HISTORY_BYTES = 512 * 1024L    // ~a few days of normal use
    private const val MAX_PENDING_BYTES = 4 * 1024 * 1024L // ~days offline before oldest is dropped

    private val memory = ArrayDeque<String>()
    private val fileLock = Any()
    private val timeFormat = SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault())

    private var historyFile: File? = null
    private var pendingFile: File? = null

    var onLogUpdate: (() -> Unit)? = null

    /** Stable random id for this installation, sent with every upload. */
    lateinit var deviceId: String
        private set

    fun init(context: Context) {
        val dir = File(context.filesDir, "logs").apply { mkdirs() }
        historyFile = File(dir, "history.log")
        pendingFile = File(dir, "pending.jsonl")
        val prefs = context.getSharedPreferences(SettingsActivity.PREFS, Context.MODE_PRIVATE)
        deviceId = prefs.getString(KEY_DEVICE_ID, null) ?: ("android-" + UUID.randomUUID().toString().take(8)).also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }
        // Show the previous session's lines on the log screen after a restart.
        historyFile?.takeIf { it.exists() }?.readLines()?.takeLast(MAX_MEMORY)?.let { lines ->
            synchronized(memory) { lines.forEach { memory.addFirst(it) } }
        }
    }

    private const val KEY_DEVICE_ID = "log_device_id"

    // ── Logging API ───────────────────────────────────────────────────────────

    fun debug(event: String, message: String, orderId: String? = null) = write(Level.DEBUG, event, message, orderId)
    fun info(event: String, message: String, orderId: String? = null) = write(Level.INFO, event, message, orderId)
    fun warn(event: String, message: String, orderId: String? = null) = write(Level.WARN, event, message, orderId)
    fun error(event: String, message: String, orderId: String? = null, error: Throwable? = null) =
        write(Level.ERROR, event, message, orderId, error)

    /** Older call sites: the level is read from the message's ⚠ / ✖ prefix. */
    fun log(message: String) {
        val level = when {
            message.startsWith("✖") -> Level.ERROR
            message.startsWith("⚠") -> Level.WARN
            else -> Level.INFO
        }
        write(level, "app", message.removePrefix("✖").removePrefix("⚠").trim(), null)
    }

    /**
     * Writes straight to disk on the calling thread - for the crash handler,
     * where the process is about to die and nothing else will run.
     */
    fun crash(thread: Thread, error: Throwable) {
        write(Level.ERROR, "app.crash", "Crash on thread ${thread.name}: $error", null, error)
    }

    private fun write(level: Level, event: String, message: String, orderId: String?, error: Throwable? = null) {
        val now = System.currentTimeMillis()
        val line = "[${timeFormat.format(Date(now))}] ${level.name.first()} $message"
        when (level) {
            Level.ERROR -> Log.e(TAG, message, error)
            Level.WARN -> Log.w(TAG, message)
            else -> Log.i(TAG, message)
        }

        synchronized(memory) {
            memory.addFirst(line)
            while (memory.size > MAX_MEMORY) memory.removeLast()
        }

        if (level != Level.DEBUG) {
            val json = JSONObject().apply {
                put("ts", now)
                put("level", level.tag)
                put("event", event)
                put("message", message)
                if (orderId != null) put("orderId", orderId)
                if (error != null) {
                    put("data", JSONObject().put("stack", Log.getStackTraceString(error).lineSequence().take(25).joinToString("\n")))
                }
            }
            appendToFiles(line, json.toString())
        }
        onLogUpdate?.invoke()
    }

    private fun appendToFiles(historyLine: String, pendingLine: String) {
        try {
            synchronized(fileLock) {
                historyFile?.let { f ->
                    if (f.length() > MAX_HISTORY_BYTES) trimToNewestHalf(f)
                    f.appendText(historyLine + "\n")
                }
                pendingFile?.let { f ->
                    if (f.length() > MAX_PENDING_BYTES) trimToNewestHalf(f)
                    f.appendText(pendingLine + "\n")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not write log file: ${e.message}")
        }
    }

    private fun trimToNewestHalf(f: File) {
        val lines = f.readLines()
        f.writeText(lines.drop(lines.size / 2).joinToString("\n", postfix = "\n"))
    }

    // ── Upload queue (used by LogUploader) ────────────────────────────────────

    /** Up to [max] of the oldest not-yet-uploaded entries, as JSON lines. */
    fun peekPending(max: Int): List<String> = synchronized(fileLock) {
        pendingFile?.takeIf { it.exists() }?.useLines { it.filter(String::isNotBlank).take(max).toList() } ?: emptyList()
    }

    /** Removes the first [count] entries once the server has stored them. */
    fun removePending(count: Int) = synchronized(fileLock) {
        val f = pendingFile ?: return@synchronized
        if (!f.exists() || count <= 0) return@synchronized
        val rest = f.readLines().filter(String::isNotBlank).drop(count)
        val tmp = File(f.parentFile, "pending.tmp")
        tmp.writeText(if (rest.isEmpty()) "" else rest.joinToString("\n", postfix = "\n"))
        if (!tmp.renameTo(f)) { f.writeText(tmp.readText()); tmp.delete() }
    }

    fun pendingCount(): Int = synchronized(fileLock) {
        pendingFile?.takeIf { it.exists() }?.useLines { lines -> lines.count { it.isNotBlank() } } ?: 0
    }

    // ── Log screen ────────────────────────────────────────────────────────────

    fun getLogs(): String = synchronized(memory) { memory.joinToString("\n") }

    /** Clears the on-screen and history log. Entries not yet uploaded are kept. */
    fun clear() {
        synchronized(memory) { memory.clear() }
        synchronized(fileLock) { historyFile?.writeText("") }
        onLogUpdate?.invoke()
    }
}
