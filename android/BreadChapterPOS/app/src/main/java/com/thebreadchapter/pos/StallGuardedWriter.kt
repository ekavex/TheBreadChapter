package com.thebreadchapter.pos

import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Writes a print job in small chunks and only gives up when the printer stops
 * accepting data, not when the whole job takes a while.
 *
 * A Bluetooth thermal printer takes data about as fast as it prints, so a bill
 * with a logo (~8 KB) can legitimately take well over 4 seconds to send. The old
 * fixed 4-second limit cut such writes off after the printer already had most of
 * the bill, then resent the whole thing - a duplicate bill. Here the watchdog
 * only fires after [stallTimeoutMs] with no chunk accepted at all, and a failure
 * reports how many bytes the printer had already taken, so the caller can tell
 * "nothing printed, safe to retry" from "partly printed, don't resend".
 */
object StallGuardedWriter {

    const val DEFAULT_CHUNK_SIZE = 256

    class WriteFailedException(val bytesSent: Int, val totalBytes: Int, cause: Throwable) :
        IOException("Printer stopped after $bytesSent of $totalBytes bytes: ${cause.message}", cause)

    /**
     * @param abort called (once, from the watchdog thread) when the printer has
     *   accepted nothing for [stallTimeoutMs]; it must make the blocked write
     *   fail, e.g. by closing the Bluetooth socket.
     */
    fun write(
        out: OutputStream,
        payload: ByteArray,
        stallTimeoutMs: Long,
        abort: () -> Unit,
        chunkSize: Int = DEFAULT_CHUNK_SIZE,
    ) {
        val lastProgressAt = AtomicLong(System.nanoTime())
        val done = AtomicBoolean(false)
        val stallNanos = stallTimeoutMs * 1_000_000

        val watchdog = Thread {
            try {
                while (!done.get()) {
                    Thread.sleep(100)
                    if (!done.get() && System.nanoTime() - lastProgressAt.get() > stallNanos) {
                        abort()
                        return@Thread
                    }
                }
            } catch (_: InterruptedException) {
                // Write finished - nothing to do.
            }
        }.apply { isDaemon = true; name = "print-stall-watchdog" }

        var sent = 0
        watchdog.start()
        try {
            while (sent < payload.size) {
                val len = minOf(chunkSize, payload.size - sent)
                out.write(payload, sent, len)
                out.flush()
                sent += len
                lastProgressAt.set(System.nanoTime())
            }
        } catch (e: Exception) {
            throw WriteFailedException(sent, payload.size, e)
        } finally {
            done.set(true)
            watchdog.interrupt()
        }
    }
}
