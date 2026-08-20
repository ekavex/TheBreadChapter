package com.thebreadchapter.pos

import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Builds ESC/POS byte payloads for 58mm thermal printers (32 char columns).
// Matches the format produced by the TypeScript BluetoothPrinterService.
object EscPosHelper {

    private const val COLS = 32

    // ESC/POS command bytes
    private val INIT          = byteArrayOf(0x1B, 0x40)
    private val ALIGN_CENTER  = byteArrayOf(0x1B, 0x61, 0x01)
    private val ALIGN_LEFT    = byteArrayOf(0x1B, 0x61, 0x00)
    private val BOLD_ON       = byteArrayOf(0x1B, 0x45, 0x01)
    private val BOLD_OFF      = byteArrayOf(0x1B, 0x45, 0x00)
    private val DOUBLE_HEIGHT = byteArrayOf(0x1B, 0x21, 0x10)
    private val NORMAL_SIZE   = byteArrayOf(0x1B, 0x21, 0x00)
    private val FULL_CUT      = byteArrayOf(0x1D, 0x56, 0x00)

    private fun feed() = byteArrayOf(0x1B, 0x64, 0x04)
    private fun text(s: String) = (s + "\n").toByteArray(Charsets.UTF_8)

    private val DIV = "-".repeat(COLS) + "\n"

    private fun padRight(s: String, len: Int): String =
        if (s.length >= len) s.substring(0, len) else s + " ".repeat(len - s.length)

    fun buildKotTicket(
        tableLabel: String,
        orderId: String,
        station: String,
        items: List<Map<String, Any>>,
    ): ByteArray {
        val out = ByteArrayOutputStream()

        fun w(b: ByteArray) = out.write(b)

        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val shortId = orderId.takeLast(6).uppercase()
        val stationLabel = if (station == "kitchen") "** KITCHEN **" else "** BEVERAGE **"

        w(INIT)
        w(ALIGN_CENTER)
        w(BOLD_ON)
        w(DOUBLE_HEIGHT)
        w(text(stationLabel))
        w(NORMAL_SIZE)
        w(BOLD_OFF)
        w(text("Table: $tableLabel  $time"))
        w(text("Order #$shortId"))
        w(text(DIV.trimEnd()))
        w(ALIGN_LEFT)

        for (item in items) {
            val qty  = (item["quantity"] as? Number)?.toInt() ?: 1
            val name = (item["name"] as? String) ?: ""
            val prefix = "${qty.toString().padStart(2)}x  "
            val namePadded = padRight(name, COLS - prefix.length)
            w(BOLD_ON)
            w(text(prefix + namePadded))
            w(BOLD_OFF)
        }

        w(ALIGN_CENTER)
        w(text(DIV.trimEnd()))
        w(feed())
        w(FULL_CUT)

        return out.toByteArray()
    }
}
