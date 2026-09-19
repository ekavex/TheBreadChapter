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

    // Customer bill runs in Font B (condensed, ~9-dot glyphs) instead of the
    // KOT's Font A, since fitting the legal/GST/address block plus item+price
    // rows within 48mm needs more than 32 columns. The font bit lives inside
    // the same ESC ! byte as bold/height/width, so it's baked into each of
    // these rather than selected separately - that avoids ESC ! calls
    // elsewhere silently resetting the font back to A.
    private val FONT_B_NORMAL        = byteArrayOf(0x1B, 0x21, 0x01)
    private val FONT_B_DOUBLE_HEIGHT = byteArrayOf(0x1B, 0x21, 0x11)
    private const val BILL_COLS = 42
    private val BILL_DIV = "-".repeat(BILL_COLS)
    // ~8 dots/mm on a 384-dot / 48mm printable head.
    private const val DOTS_PER_MM = 8
    private const val LOGO_WIDTH_DOTS = 33 * DOTS_PER_MM  // ~33mm, within the 32-35mm target
    private const val QR_MODULE_SIZE = 4                  // ~19-21mm square (0.5x of prior 8) for a typical UPI payload

    private fun feed() = byteArrayOf(0x1B, 0x64, 0x04)
    private fun text(s: String) = (s + "\n").toByteArray(Charsets.UTF_8)

    private val DIV = "-".repeat(COLS) + "\n"

    private fun padRight(s: String, len: Int): String =
        if (s.length >= len) s.substring(0, len) else s + " ".repeat(len - s.length)

    // Returns a left+right row that fills exactly `cols` characters.
    private fun rowLine(left: String, right: String, cols: Int = COLS): String {
        val space = cols - left.length - right.length
        return if (space <= 0) "${left.take(cols - right.length - 1)} $right"
        else left + " ".repeat(space) + right
    }

    // Greedy word-wrap to a fixed width - used for the bill's static legal/
    // address block and for any item name/addon too long for one line.
    private fun wrapText(s: String, cols: Int): List<String> {
        val lines = mutableListOf<String>()
        var cur = StringBuilder()
        for (word in s.split(" ")) {
            val next = if (cur.isEmpty()) word else "$cur $word"
            if (next.length <= cols) {
                cur = StringBuilder(next)
            } else {
                if (cur.isNotEmpty()) lines.add(cur.toString())
                cur = StringBuilder(word)
            }
        }
        if (cur.isNotEmpty()) lines.add(cur.toString())
        return lines
    }

    // Prints "<label>  <price>" on one line if it fits; otherwise wraps the
    // label across lines and keeps the price right-aligned on the last one,
    // so a long item name can never push the price off the printable area.
    private fun printPricedLine(w: (ByteArray) -> Unit, label: String, price: String, cols: Int) {
        if (label.length + 1 + price.length <= cols) {
            w(text(rowLine(label, price, cols)))
            return
        }
        val wrapped = wrapText(label, cols)
        for ((i, line) in wrapped.withIndex()) {
            when {
                i != wrapped.lastIndex -> w(text(line))
                line.length + 1 + price.length <= cols -> w(text(rowLine(line, price, cols)))
                else -> {
                    w(text(line))
                    w(text(rowLine("", price, cols)))
                }
            }
        }
    }

    // Scales a bitmap down to a target dot width for the raster print
    // command, preserving aspect ratio - the source logo resource is
    // higher-res than the ~33mm the bill calls for.
    private fun scaleToWidth(bitmap: Bitmap, targetWidthDots: Int): Bitmap {
        if (bitmap.width <= targetWidthDots) return bitmap
        val ratio = targetWidthDots.toFloat() / bitmap.width
        val targetHeight = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, targetWidthDots, targetHeight, true)
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
    //
    // Runs in Font B (42 cols on a 58mm/384-dot head) instead of the KOT's
    // Font A (32 cols) - the legal name, GST number and full address below
    // the logo don't fit otherwise. See FONT_B_NORMAL/FONT_B_DOUBLE_HEIGHT.
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

        val timeStr = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val dateStr = SimpleDateFormat("dd/MM/yy", Locale.getDefault()).format(Date())
        val shortId = orderId.takeLast(6).uppercase()
        val totalRupees = amountPaisa / 100.0
        val totalStr = "Rs. %.2f".format(totalRupees)

        w(INIT)
        w(FONT_B_NORMAL)
        w(ALIGN_CENTER)

        // ── Logo + brand ─────────────────────────────────────────────────────
        if (logo != null) {
            w(rasterImage(scaleToWidth(logo, LOGO_WIDTH_DOTS)))
            w(LF)
        }
        w(BOLD_ON)
        w(text("THE BREAD CHAPTER"))
        w(BOLD_OFF)

        // ── Legal name / GST / address ───────────────────────────────────────
        for (line in wrapText("The Bread Chapter (ANV HOSPITALITY PVT. LTD)", BILL_COLS)) w(text(line))
        for (line in wrapText("GST NO - 27ABFCA1460M1ZK", BILL_COLS)) w(text(line))
        for (line in wrapText(
            "ADDRESS - VEDAS CENTRE DP ROAD NR SHIV SAGAR AUNDH PUNE, Aundh, Pune Municipal Corporation, Maharashtra - 411007",
            BILL_COLS,
        )) w(text(line))

        w(text(BILL_DIV))

        // ── Table ─────────────────────────────────────────────────────────────
        w(BOLD_ON)
        w(text("Table: $tableLabel"))
        w(BOLD_OFF)

        // ── Order # / time / date ────────────────────────────────────────────
        w(ALIGN_LEFT)
        w(text(rowLine("Order #$shortId", "$timeStr   $dateStr", BILL_COLS)))

        w(ALIGN_CENTER)
        w(text(BILL_DIV))
        w(ALIGN_LEFT)

        // ── Items ─────────────────────────────────────────────────────────────
        for (item in items) {
            val qty   = (item["quantity"] as? Number)?.toInt() ?: 1
            val name  = (item["name"] as? String) ?: ""
            val sub   = (item["subtotal"] as? Number)?.toInt() ?: 0
            val price = "Rs. %d".format(sub)
            printPricedLine(::w, "${qty}x $name", price, BILL_COLS)

            @Suppress("UNCHECKED_CAST")
            val addonList = item["addons"] as? List<String> ?: emptyList()
            for (addon in addonList) {
                for (line in wrapText("  + $addon", BILL_COLS)) w(text(line))
            }
        }

        // Customer note - a real order detail, not part of the fixed layout
        // below, but it must not silently vanish from the printed bill.
        if (!customerNote.isNullOrBlank()) {
            w(BOLD_ON)
            for (line in wrapText("Note: ${customerNote.trim()}", BILL_COLS)) w(text(line))
            w(BOLD_OFF)
        }

        w(ALIGN_CENTER)
        w(text(BILL_DIV))
        w(ALIGN_LEFT)

        // ── Total ─────────────────────────────────────────────────────────────
        w(BOLD_ON)
        w(FONT_B_DOUBLE_HEIGHT)
        w(text(rowLine("TOTAL", totalStr, BILL_COLS)))
        w(FONT_B_NORMAL)
        w(BOLD_OFF)

        w(ALIGN_CENTER)
        w(text(BILL_DIV))

        // ── QR code ───────────────────────────────────────────────────────────
        w(BOLD_ON)
        w(text("Scan & Pay via UPI"))
        w(BOLD_OFF)
        w(LF)
        w(qrCode(upiUrl, moduleSize = QR_MODULE_SIZE))
        w(LF)
        w(BOLD_ON)
        w(text(totalStr))
        w(BOLD_OFF)

        w(text(BILL_DIV))

        w(feed())
        w(FULL_CUT)

        return out.toByteArray()
    }
}
