package com.thebreadchapter.pos

import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.pinelabs.billing.sdk.PineBillingSdk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import uniffi.pine_billing.CurrencyCode
import uniffi.pine_billing.PaymentMode
import uniffi.pine_billing.SdkException
import uniffi.pine_billing.TransactionListener
import uniffi.pine_billing.TransactionOptions
import uniffi.pine_billing.TransactionRequest
import uniffi.pine_billing.TransactionResult
import uniffi.pine_billing.TransactionStatus
import uniffi.pine_billing.TransactionType
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Exposed to the WebView as `window.AndroidPinePayment`.
 *
 * The web app calls:
 *   window.AndroidPinePayment.startPayment(orderId, amountPaise, mode)
 *
 * After Pine Labs responds the bridge calls back:
 *   window.onPineLabsResult({ok, txnId, status, message})
 *
 * The web app then calls /api/pos/orders/:id/pay with the native_result
 * so the server can mark the order PAID without a second Pine Labs round-trip.
 */
class PinePaymentBridge(
    private val webView: WebView,
    private val app: BreadChapterApp,
) {
    private val busy = AtomicBoolean(false)

    /** Returns true so the web app can detect that this bridge is present. */
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /** Returns true if the Pine Billing SDK has been successfully initialised. */
    @JavascriptInterface
    fun isSdkReady(): Boolean = PineBillingSdk.isInitialized()

    /**
     * Initiate an AppToApp payment.
     *
     * @param orderId       Your cafe order ID used as billingReferenceId.
     * @param amountPaise   Total amount in the **smallest currency unit** (paise).
     *                      ₹300 → pass 30000.
     * @param mode          "card" or "upi" (case-insensitive). Defaults to CARD.
     */
    @JavascriptInterface
    fun startPayment(orderId: String, amountPaise: Long, mode: String) {
        if (!busy.compareAndSet(false, true)) {
            deliverResult(ok = false, txnId = null, status = "busy",
                message = "A payment is already in progress")
            return
        }

        if (!PineBillingSdk.isInitialized()) {
            // Try to re-initialise (settings may have been saved after app start).
            app.tryInitPineSdk()
        }
        if (!PineBillingSdk.isInitialized()) {
            busy.set(false)
            deliverResult(ok = false, txnId = null, status = "not_configured",
                message = "Pine Billing SDK not initialised - set Application ID in Settings")
            return
        }

        val paymentMode = when (mode.lowercase()) {
            "upi"  -> PaymentMode.UPI
            else   -> PaymentMode.CARD
        }

        val request = TransactionRequest(
            transactionType      = TransactionType.SALE,
            allowedPaymentModes  = listOf(paymentMode),
            transactionOptions   = TransactionOptions(
                currency           = CurrencyCode.INR,
                billingReferenceId = orderId,
                amount             = amountPaise,
                // remaining nullable fields
                customerMobile        = null,
                customerEmail         = null,
                additionalInfo        = null,
            ),
            transportOptions = null,
        )

        AppLogManager.log("Pine pay → orderId=$orderId amount=${amountPaise}p mode=${paymentMode.name}")

        CoroutineScope(Dispatchers.IO).launch {
            PineBillingSdk.shared().doTransaction(request, object : TransactionListener {
                override fun onStarted(eventId: String) {
                    AppLogManager.log("Pine pay started eventId=$eventId")
                }

                override fun onResult(result: TransactionResult) {
                    val ok = result.status == TransactionStatus.SUCCESS
                    AppLogManager.log("Pine pay result status=${result.status} txnId=${result.transactionId}")
                    busy.set(false)
                    deliverResult(
                        ok      = ok,
                        txnId   = result.transactionId,
                        status  = result.status.name.lowercase(),
                        message = result.responseMessage,
                    )
                }

                override fun onFailure(error: SdkException) {
                    AppLogManager.log("Pine pay failure: ${error.message}")
                    busy.set(false)
                    deliverResult(
                        ok      = false,
                        txnId   = null,
                        status  = "sdk_error",
                        message = error.message ?: "SDK error",
                    )
                }
            })
        }
    }

    private fun deliverResult(ok: Boolean, txnId: String?, status: String, message: String?) {
        val payload = JSONObject().apply {
            put("ok",      ok)
            put("txnId",   txnId ?: JSONObject.NULL)
            put("status",  status)
            put("message", message ?: JSONObject.NULL)
        }.toString()

        webView.post {
            webView.evaluateJavascript("window.onPineLabsResult && window.onPineLabsResult($payload)", null)
        }
    }
}
