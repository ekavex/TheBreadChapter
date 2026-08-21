package com.thebreadchapter.pos

import java.text.SimpleDateFormat
import java.util.*

object AppLogManager {
    private val logs = mutableListOf<String>()
    private const val MAX_LOGS = 100
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    var onLogUpdate: (() -> Unit)? = null

    fun log(message: String) {
        val timestamp = timeFormat.format(Date())
        val entry = "[$timestamp] $message"
        synchronized(logs) {
            logs.add(0, entry)
            if (logs.size > MAX_LOGS) {
                logs.removeAt(logs.size - 1)
            }
        }
        onLogUpdate?.invoke()
    }

    fun getLogs(): String {
        return synchronized(logs) {
            logs.joinToString("\n")
        }
    }

    fun clear() {
        synchronized(logs) {
            logs.clear()
        }
        onLogUpdate?.invoke()
    }
}
