package com.thebreadchapter.pos

import android.graphics.Bitmap
import android.graphics.Color
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
    private val DOUBLE_HEIGHT = byteArrayOf(0x1B, 0x21, 0x10)  // tall, normal width (32 cols)
    private val DOUBLE_SIZE   = byteArrayOf(0x1B, 0x21, 0x30)  // tall + wide (16 cols max)
    private val NORMAL_SIZE   = byteArrayOf(0x1B, 0x21, 0x00)
    private val FULL_CUT      = byteArrayOf(0x1D, 0x56, 0x00)
    private val LF            = byteArrayOf(0x0A)

    private fun feed() = byteArrayOf(0x1B, 0x64, 0x04)
    private fun text(s: String) = (s + "\n").toByteArray(Charsets.UTF_8)

    private val DIV = "-".repeat(COLS) + "\n"

    private fun padRight(s: String, len: Int): String =
        if (s.length >= len) s.substring(0, len) else s + " ".repeat(len - s.length)

    // Returns a left+right row that fills exactly COLS characters.
    private fun rowLine(left: String, right: String): String {
        val space = COLS - left.length - right.length
        return if (space <= 0) "${left.take(COLS - right.length - 1)} $right"
        else left + " ".repeat(space) + right
    }

    // ESC/POS GS ( k sequence to print a QR code (Model 2, error level L).
    private fun qrCode(data: String, moduleSize: Int = 4): ByteArray {
        val out = ByteArrayOutputStream()
        val bytes = data.toByteArray(Charsets.UTF_8)
        val n = bytes.size

        // Select model 2
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 4, 0, 49, 65, 2, 0))
        // Module size (dots per cell)
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 3, 0, 49, 67, moduleSize.toByte(), 0))
        // Error correction level L (lightest - smaller QR, still scannable)
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 3, 0, 49, 69, 48, 0))
        // Store data: pL pH = (n + 3) split across low/high byte
        val pL = ((n + 3) and 0xFF).toByte()
        val pH = ((n + 3) ushr 8).toByte()
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, pL, pH, 49, 80, 48))
        out.write(bytes)
        // Print stored symbol
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 3, 0, 49, 81, 48))

        return out.toByteArray()
    }

    // ESC/POS GS v 0 raster bit image - prints a 1-bit monochrome bitmap
    // (already dithered to black/white at build time; luminance is thresholded
    // here mainly as a safety net for any bitmap that isn't pre-dithered).
    private fun rasterImage(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val bytesPerRow = (width + 7) / 8
        val out = ByteArrayOutputStream()

        out.write(byteArrayOf(0x1D, 0x76, 0x30, 0x00))
        out.write(byteArrayOf((bytesPerRow and 0xFF).toByte(), ((bytesPerRow shr 8) and 0xFF).toByte()))
        out.write(byteArrayOf((height and 0xFF).toByte(), ((height shr 8) and 0xFF).toByte()))

        for (y in 0 until height) {
            var bitBuf = 0
            var bitCount = 0
            for (x in 0 until width) {
                val pixel = bitmap.getPixel(x, y)
                val isBlack = Color.alpha(pixel) > 127 &&
                    (0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)) < 160
                bitBuf = (bitBuf shl 1) or (if (isBlack) 1 else 0)
                bitCount++
                if (bitCount == 8) {
                    out.write(bitBuf)
                    bitBuf = 0
                    bitCount = 0
                }
            }
            if (bitCount > 0) {
                out.write(bitBuf shl (8 - bitCount))
            }
        }

        return out.toByteArray()
    }

    fun buildKotTicket(
        tableLabel: String,
        orderId: String,
        station: String,
        items: List<Map<String, Any>>,
        customerNote: String? = null,
        takenBy: String? = null,
    ): ByteArray {
        val out = ByteArrayOutputStream()

        fun w(b: ByteArray) = out.write(b)

        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val shortId = orderId.takeLast(6).uppercase()
        val totalCount = items.sumOf { (it["quantity"] as? Number)?.toInt() ?: 1 }

        w(INIT)
        w(ALIGN_CENTER)

        // Table label - large and prominent (no station header)
        w(BOLD_ON)
        w(DOUBLE_SIZE)
        w(text("TABLE: $tableLabel"))
        w(NORMAL_SIZE)
        w(BOLD_OFF)

        w(text("$time  #$shortId"))
        w(text(DIV.trimEnd()))
        w(ALIGN_LEFT)

        // Items - double-height for easy reading across the barista station
        for (item in items) {
            val qty  = (item["quantity"] as? Number)?.toInt() ?: 1
            val name = (item["name"] as? String) ?: ""
            val prefix = "${qty.toString().padStart(2)}x  "
            val nameTrunc = name.take(COLS - prefix.length)
            w(BOLD_ON)
            w(DOUBLE_HEIGHT)
            w(text(prefix + nameTrunc))
            w(NORMAL_SIZE)
            w(BOLD_OFF)
            @Suppress("UNCHECKED_CAST")
            val addonList = item["addons"] as? List<String> ?: emptyList()
            for (addon in addonList) {
                w(text("     + ${addon.take(COLS - 7)}"))
            }
        }

        // Customer note (suggestions)
        if (!customerNote.isNullOrBlank()) {
            w(text(DIV.trimEnd()))
            w(BOLD_ON)
            w(text("NOTE:"))
            w(BOLD_OFF)
            w(text(customerNote.trim().take(COLS * 3)))
        }

        // Staff name + total at the bottom
        w(ALIGN_CENTER)
        w(text(DIV.trimEnd()))
        if (!takenBy.isNullOrBlank()) {
            w(text("Order taken by ${takenBy.trim().take(COLS - 15)}"))
        }
        w(BOLD_ON)
        w(text("Total: $totalCount item${if (totalCount == 1) "" else "s"}"))
        w(BOLD_OFF)

        w(feed())
        w(FULL_CUT)

        return out.toByteArray()
    }

    fun buildTestTicket(printerName: String): ByteArray {
        val out = ByteArrayOutputStream()
        fun w(b: ByteArray) = out.write(b)
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())

        w(INIT)
        w(ALIGN_CENTER)
        w(BOLD_ON)
        w(DOUBLE_HEIGHT)
        w(text("TEST PRINT"))
        w(NORMAL_SIZE)
        w(BOLD_OFF)
        w(text("Printer: $printerName"))
        w(text("Time: $time"))
        w(text(DIV.trimEnd()))
        w(text("Connectivity check successful!"))
        w(text(DIV.trimEnd()))
        w(feed())
        w(FULL_CUT)

        return out.toByteArray()
    }

    // Prints a customer-facing bill with a pre-filled UPI QR code.
    // items: each map has keys "name" (String), "quantity" (Int), "subtotal" (Int, rupees).
    // amountPaisa: bill total in paisa (used for the display total).
    // upiUrl: fully-built upi:// deep link with am= already set by the server.
    fun buildBillWithQr(
        tableLabel: String,
        orderId: String,
        items: List<Map<String, Any>>,
        amountPaisa: Long,
        upiUrl: String,
        customerNote: String? = null,
        logo: Bitmap? = null,
    ): ByteArray {
        val out = ByteArrayOutputStream()
        fun w(b: ByteArray) = out.write(b)

        val time = SimpleDateFormat("HH:mm  dd/MM/yy", Locale.getDefault()).format(Date())
        val shortId = orderId.takeLast(6).uppercase()
        val totalRupees = amountPaisa / 100.0
        val totalStr = "Rs. %.2f".format(totalRupees)

        // ── Header ────────────────────────────────────────────────────────────
        w(INIT)
        w(ALIGN_CENTER)
        if (logo != null) {
            w(rasterImage(logo))
            w(LF)
            w(BOLD_ON)
            w(text("THE BREAD CHAPTER"))
            w(BOLD_OFF)
        } else {
            // Text fallback if the logo bitmap failed to load.
            w(BOLD_ON)
            w(DOUBLE_SIZE)
            w(text("THE BREAD"))
            w(text("CHAPTER"))
            w(NORMAL_SIZE)
            w(BOLD_OFF)
        }
        w(text(DIV.trimEnd()))
        // Table label - double-height for easy reading
        w(BOLD_ON)
        w(DOUBLE_HEIGHT)
        w(text("Table: $tableLabel"))
        w(NORMAL_SIZE)
        w(BOLD_OFF)
        w(text("Order #$shortId   $time"))
        w(text(DIV.trimEnd()))

        // ── Items ─────────────────────────────────────────────────────────────
        w(ALIGN_LEFT)
        for (item in items) {
            val qty     = (item["quantity"] as? Number)?.toInt() ?: 1
            val name    = (item["name"] as? String) ?: ""
            val sub     = (item["subtotal"] as? Number)?.toInt() ?: 0
            val right   = "Rs.%d".format(sub)
            val prefix  = "${qty.toString().padStart(2)}x "
            val maxName = COLS - prefix.length - right.length - 1
            val nameTrunc = if (name.length > maxName) name.substring(0, maxName) else name
            w(BOLD_ON)
            w(text(rowLine(prefix + nameTrunc, right)))
            w(BOLD_OFF)
            @Suppress("UNCHECKED_CAST")
            val addonList = item["addons"] as? List<String> ?: emptyList()
            for (addon in addonList) {
                w(text("    + ${addon.take(COLS - 6)}"))
            }
        }

        // Customer note (suggestions)
        if (!customerNote.isNullOrBlank()) {
            w(ALIGN_LEFT)
            w(text(DIV.trimEnd()))
            w(BOLD_ON)
            w(text("NOTE:"))
            w(BOLD_OFF)
            w(text(customerNote.trim().take(COLS * 3)))
        }

        // ── Total ─────────────────────────────────────────────────────────────
        w(ALIGN_CENTER)
        w(text(DIV.trimEnd()))
        w(BOLD_ON)
        w(DOUBLE_HEIGHT)
        w(text(rowLine("TOTAL", totalStr)))
        w(NORMAL_SIZE)
        w(BOLD_OFF)
        w(text(DIV.trimEnd()))

        // ── QR Code ───────────────────────────────────────────────────────────
        w(LF)
        w(BOLD_ON)
        w(text("Scan & Pay via UPI"))
        w(BOLD_OFF)
        w(LF)
        w(qrCode(upiUrl, moduleSize = 6))
        w(LF)
        // Net total below QR - large and bold
        w(BOLD_ON)
        w(DOUBLE_HEIGHT)
        w(text(totalStr))
        w(NORMAL_SIZE)
        w(BOLD_OFF)
        w(text(DIV.trimEnd()))

        w(feed())
        w(FULL_CUT)

        return out.toByteArray()
    }
}
