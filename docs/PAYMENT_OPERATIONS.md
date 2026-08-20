# Payment Operations Guide

How money moves through this system, what each state means, and what to do when
something is stuck. Written for whoever is on shift — not just developers.

---

## 1. The payment state machine

```
BILLED ──pay──► AWAITING_PAYMENT ──┬── Pine Labs says approved ──► PAID
                                   ├── Pine Labs says declined ──► PAYMENT_FAILED
                                   ├── Pine Labs says voided   ──► PAYMENT_FAILED
                                   └── we cannot tell          ──► REQUIRES_VERIFICATION
```

| State | Means | Who resolves it |
|---|---|---|
| `AWAITING_PAYMENT` | A transaction is live on the terminal. | Resolves itself: the screen polls, the webhook pushes, the reconciler sweeps. |
| `PAID` | Pine Labs confirmed approval **and** the amount matched the bill. | Nobody — done. |
| `PAYMENT_FAILED` | Pine Labs explicitly declined, voided or cancelled. Table stays occupied. | Cashier may retry. |
| `REQUIRES_VERIFICATION` | We could not determine the outcome. **The customer may already have paid.** | A human, using the terminal and the Pine Labs report. |

The rule the whole system is built around: **a timeout is not a failure.**
Nothing marks an order failed unless Pine Labs said so.

## 2. What resolves a stuck payment, in order

1. **The POS screen** — while an order is `AWAITING_PAYMENT` it re-verifies
   every couple of seconds for up to 6 minutes. Verification only; it can never
   start a second charge.
2. **The Pine Labs webhook** — `POST /api/webhooks/pinelabs?token=…`. Treated as
   a wake-up signal only; the result is always re-verified with GetStatus.
3. **The reconciler** — sweeps every `RECONCILER_INTERVAL_MS` (default 60s) for
   orders awaiting payment for more than 90 seconds. Approved → finalize;
   declined → failed; still open after 12 minutes → `REQUIRES_VERIFICATION`.

Force a sweep by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<domain>/api/cron/reconcile-payments
```

## 3. Handling REQUIRES_VERIFICATION

Do **not** press Pay again. Instead:

1. Open the order in the POS and press **Re-check with Pine Labs**. Most cases
   clear here.
2. If it does not clear, check the A910S: is there a charge slip for this
   amount? Is a transaction still open on screen?
3. Match against the Pine Labs report using the values stored on the payment:
   `plutus_ptrid`, `rrn`, `txn_log_id`, `transaction_number`.
4. Outcome:
   - Customer **was** charged → complete the order via **Re-check** once the
     terminal has settled. Never take a second payment.
   - Customer was **not** charged → clear the open transaction on the terminal,
     then the order can be paid again.

## 4. Answering "did this payment actually succeed?"

Every attempt leaves a trail. All logs carry `requestId`, and payment logs carry
`orderId`, `paymentId` and `ptrid`.

```sql
-- Everything that happened to one order
SELECT source, reported, verified, ptrid, created_at
FROM payment_events WHERE order_id = '<order-id>' ORDER BY created_at;

-- Money that is not settled right now
SELECT order_number, pos_status, total_amount, updated_at
FROM orders
WHERE pos_status IN ('AWAITING_PAYMENT', 'REQUIRES_VERIFICATION')
ORDER BY updated_at;

-- Today's approved payments for settlement matching
SELECT o.order_number, p.rrn, p.approval_code, p.txn_log_id, p.amount_paisa, p.mode
FROM payments p JOIN orders o ON o.id = p.order_id
WHERE p.status = 'approved' AND p.created_at::date = current_date
ORDER BY p.created_at;
```

Card numbers, UPI VPAs and the security token are never stored or logged — only
what reconciliation needs.

## 5. Safety properties (do not remove these without replacing them)

| Property | Enforced by |
|---|---|
| Mock payments can never run in production | `lib/payment/provider.ts` (throws at startup) |
| One charge per order attempt | `orders.pos_status` atomic claim in the pay route |
| No re-charge while an earlier transaction may be live | `ensureNoOpenTransaction` in the pay route |
| Approval is worthless unless the amount matches | `finalizeApprovedPayment` (runs before any DB write) |
| Finalization is all-or-nothing | single transaction + `SELECT … FOR UPDATE` |
| A duplicate webhook does nothing twice | `payment_events.dedupe_key` unique index |
| Two approved payments on one order are impossible | `uniq_approved_payment_per_order` |
| Two live orders on one table are impossible | `uniq_live_order_per_table` |
| A cancel cannot discard a real payment | cancel route verifies with Pine Labs first |

## 6. Environment variables that matter for payments

| Variable | Why it matters |
|---|---|
| `PAYMENT_PROVIDER` | Must be `pinelabs` in production. `mock` is refused there. |
| `PINELABS_MERCHANT_ID` / `_SECURITY_TOKEN` / `_STORE_ID` | Validated at startup; wrong types are rejected rather than silently sent as `0`. |
| `PINELABS_BASE_URL` | UAT vs production host. **Confirm the production host with Pine Labs.** |
| `PINELABS_WEBHOOK_SECRET` | Required in production; the webhook rejects callers without it. |
| `PINELABS_TIMEOUT_MS` | Per-request timeout (default 15s). |
| `RECONCILER_INTERVAL_MS` / `RECONCILER_DISABLED` | Sweep cadence. Disable only when an external cron drives the endpoint. |
| `CRON_SECRET` | Auth for the manual sweep endpoint. |

## 7. Still to confirm with Pine Labs before go-live

- Production host and exact endpoint paths.
- Whether the Post Back URL supports a query token or a custom header (the
  webhook accepts either) and any signature scheme they offer.
- The full `ResponseCode` list, especially codes meaning "still open".
- `ClientId` per physical A910S, for terminal routing.
- Settlement report access for daily RRN / TransactionLogId matching.
