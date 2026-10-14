package com.thebreadchapter.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class StallGuardedWriterTest {

    private val bill = ByteArray(8 * 1024) { (it % 251).toByte() } // ~ a bill with logo

    // Accepts every chunk, but slowly - like a printer taking data as it prints.
    private class SlowPrinter(private val delayPerChunkMs: Long) : OutputStream() {
        val received = ByteArrayOutputStream()
        override fun write(b: Int) { received.write(b) }
        override fun write(b: ByteArray, off: Int, len: Int) {
            Thread.sleep(delayPerChunkMs)
            received.write(b, off, len)
        }
    }

    // Accepts `acceptBytes`, then blocks until the connection is closed.
    private class StallingPrinter(private val acceptBytes: Int) : OutputStream() {
        private var accepted = 0
        val closed = CountDownLatch(1)
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
        override fun write(b: ByteArray, off: Int, len: Int) {
            if (accepted + len > acceptBytes) {
                closed.await(10, TimeUnit.SECONDS)
                throw IOException("socket closed")
            }
            accepted += len
        }
    }

    @Test
    fun slowButSteadyWriteIsNeverCutOff() {
        val printer = SlowPrinter(delayPerChunkMs = 40) // 32 chunks -> ~1.3s total
        val aborts = AtomicInteger()
        val started = System.nanoTime()

        StallGuardedWriter.write(printer, bill, stallTimeoutMs = 300, abort = { aborts.incrementAndGet() })

        val tookMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("whole write ($tookMs ms) should take longer than the stall limit", tookMs > 300)
        assertEquals(0, aborts.get())
        assertTrue(bill.contentEquals(printer.received.toByteArray()))
    }

    @Test
    fun stalledPrinterIsAbortedAndReportsHowMuchItTook() {
        val printer = StallingPrinter(acceptBytes = 1024)
        val aborts = AtomicInteger()

        try {
            StallGuardedWriter.write(printer, bill, stallTimeoutMs = 300, abort = {
                aborts.incrementAndGet()
                printer.closed.countDown()
            })
            fail("expected the write to fail")
        } catch (e: StallGuardedWriter.WriteFailedException) {
            assertEquals(1024, e.bytesSent)
            assertEquals(bill.size, e.totalBytes)
        }
        assertEquals(1, aborts.get())
    }

    @Test
    fun deadConnectionReportsNothingSentSoARetryIsSafe() {
        val dead = object : OutputStream() {
            override fun write(b: Int) = throw IOException("broken pipe")
            override fun write(b: ByteArray, off: Int, len: Int) = throw IOException("broken pipe")
        }
        var aborted = false
        try {
            StallGuardedWriter.write(dead, bill, stallTimeoutMs = 300, abort = { aborted = true })
            fail("expected the write to fail")
        } catch (e: StallGuardedWriter.WriteFailedException) {
            assertEquals(0, e.bytesSent)
        }
        assertFalse(aborted)
    }
}
