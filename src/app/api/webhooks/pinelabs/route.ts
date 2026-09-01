// POST /api/webhooks/pinelabs
//
// Pine Labs pushes payment results here (Post Back URL - register this with
// Pine Labs during onboarding). The body is application/x-www-form-urlencoded
// but the *value* is a single comma-joined "key=value" CSV string - NOT
// standard URL-encoded form fields (see PINELABS_INTEGRATION_MASTER.md §6).
//
// Security posture:
//   • No session cookie - Pine Labs calls this server-to-server. Instead the
//     caller must present the shared secret configured as
//     PINELABS_WEBHOOK_SECRET, either as ?token=… on the registered Post Back
//     URL or as an X-Webhook-Token header. Confirm with Pine Labs which of the
//     two their account supports when registering the URL.
//   • We NEVER trust the postback alone for money decisions. After parsing we
//     always re-verify via GetStatus before finalizing. The postback is only a
//     wake-up signal.
//   • Internal failures return 5xx so Pine Labs retries - silently swallowing
//     them with a 200 loses the payment result entirely.

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { paymentProvider } from '@/lib/payment/provider'
import { finalizeApprovedPayment, PaymentAmountMismatchError } from '@/lib/payment/finalize'
import { logger } from '@/lib/logger'
import { recordPaymentEvent } from '@/lib/payment/events'
import { parsePostBackBody } from '@/lib/payment/postback'
import { toStorableJson } from '@/lib/observability/redact'
import { resolveStoreId } from '@/lib/payment/terminals'
import type { Order, Payment } from '@/lib/types'

export const dynamic = 'force-dynamic'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.PINELABS_WEBHOOK_SECRET?.trim()
  if (!expected) {
    // No secret configured: allowed only outside production, so local testing
    // still works while a production deployment can never expose this openly.
    return process.env.NODE_ENV !== 'production'
  }
  const provided =
    req.headers.get('x-webhook-token')?.trim() ??
    new URL(req.url).searchParams.get('token')?.trim() ??
    ''
  return provided.length > 0 && timingSafeEqual(provided, expected)
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    logger.warn('webhook.pinelabs.unauthorized', {})
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Could not read body' }, { status: 400 })
  }

  const fields = parsePostBackBody(rawBody)
  const ptrid             = fields['PlutusTransactionReferenceID']
  const transactionNumber = fields['TransactionNumber']
  const postbackCode      = Number(fields['ResponseCode'] ?? '-1')

  logger.info('webhook.pinelabs.received', {
    ptrid,
    transactionNumber,
    responseCode: postbackCode,
    responseMessage: fields['ResponseMessage'],
  })

  // Unparseable payload - retrying will not help, acknowledge it.
  if (!ptrid && !transactionNumber) {
    logger.warn('webhook.pinelabs.unidentifiable', { raw: rawBody.slice(0, 200) })
    return NextResponse.json({ ok: true })
  }

  try {
    const sql = getDb()

    // Find the payment row
    let paymentRows: ReturnType<typeof sql>
    if (ptrid && transactionNumber) {
      paymentRows = sql`
        SELECT * FROM payments
        WHERE plutus_ptrid = ${ptrid} OR transaction_number = ${transactionNumber}
        ORDER BY created_at DESC
        LIMIT 1
      `
    } else if (ptrid) {
      paymentRows = sql`SELECT * FROM payments WHERE plutus_ptrid = ${ptrid} ORDER BY created_at DESC LIMIT 1`
    } else {
      paymentRows = sql`SELECT * FROM payments WHERE transaction_number = ${transactionNumber} ORDER BY created_at DESC LIMIT 1`
    }
    const [paymentRaw] = await paymentRows
    if (!paymentRaw) {
      // Not ours (or not yet written). Acknowledge - a retry storm would not help.
      logger.warn('webhook.pinelabs.payment_not_found', { ptrid, transactionNumber })
      return NextResponse.json({ ok: true })
    }
    const payment = paymentRaw as Payment

    // Find the order with items and table
    const [orderRaw] = await sql`SELECT * FROM orders WHERE id = ${payment.order_id}`
    if (!orderRaw) {
      logger.warn('webhook.pinelabs.order_not_found', { orderId: payment.order_id })
      return NextResponse.json({ ok: true })
    }
    const items = await sql`SELECT * FROM order_items WHERE order_id = ${payment.order_id} ORDER BY created_at`
    const [tableRow] = orderRaw.table_id
      ? await sql`SELECT t.*, s.name AS section_name FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${orderRaw.table_id}`
      : [null]
    const table = tableRow ? { ...tableRow, section: tableRow.section_name ? { name: tableRow.section_name } : null } : null
    const order = { ...orderRaw, items, table } as unknown as Order

    // Idempotency: a duplicate or late postback for a settled order is a no-op.
    if (['PAID', 'CANCELLED'].includes(order.pos_status)) {
      logger.info('webhook.pinelabs.already_terminal', { orderId: order.id, posStatus: order.pos_status })
      return NextResponse.json({ ok: true })
    }

    const resolvedPtrid = ptrid ?? payment.plutus_ptrid
    if (!resolvedPtrid) {
      logger.warn('webhook.pinelabs.no_ptrid', { orderId: order.id })
      return NextResponse.json({ ok: true })
    }

    // De-duplicate: Pine Labs may deliver the same postback several times.
    // The unique dedupe_key makes the second delivery a no-op.
    const dedupeKey = `webhook:${resolvedPtrid}:${postbackCode}:${fields['ResponseMessage'] ?? ''}:${fields['TransactionLogId'] ?? ''}`
    const isFirstDelivery = await recordPaymentEvent({
      paymentId: payment.id,
      orderId: order.id,
      source: 'webhook',
      ptrid: resolvedPtrid,
      dedupeKey,
      reported: fields['ResponseMessage'] ?? String(postbackCode),
    })
    if (!isFirstDelivery) {
      logger.info('webhook.pinelabs.duplicate', { orderId: order.id, ptrid: resolvedPtrid })
      return NextResponse.json({ ok: true })
    }

    // Source of truth - never the postback body.
    const statusResult = await paymentProvider.status(resolvedPtrid, {
      clientId: payment.client_id ?? '',
      storeId:  payment.store_id  ?? resolveStoreId(),
    })

    logger.info('webhook.pinelabs.status_verified', {
      orderId: order.id,
      ptrid:   resolvedPtrid,
      status:  statusResult.status,
    })

    if (statusResult.status === 'approved') {
      try {
        await finalizeApprovedPayment(order, payment, statusResult, null, null)
        logger.info('webhook.pinelabs.finalized', { orderId: order.id })
      } catch (err) {
        if (err instanceof PaymentAmountMismatchError) {
          // Retrying cannot fix a mismatch - acknowledge and leave the order
          // in AWAITING_PAYMENT for manual verification.
          logger.error('webhook.pinelabs.amount_mismatch', { orderId: order.id, ptrid: resolvedPtrid })
          return NextResponse.json({ ok: true })
        }
        throw err
      }
      return NextResponse.json({ ok: true })
    }

    if (statusResult.status === 'declined' || statusResult.status === 'cancelled') {
      await sql`
        UPDATE payments
        SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
            raw_response = ${sql.json(toStorableJson(statusResult) as never)}
        WHERE id = ${payment.id}
      `
      await sql`
        UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
        WHERE id = ${order.id} AND pos_status <> 'PAID'
      `
      logger.info('webhook.pinelabs.failed', { orderId: order.id, status: statusResult.status })
    }

    // 'pending' → still open on the terminal; nothing to do, the reconciler
    // and the cashier's status check will settle it.
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Real internal failure: ask Pine Labs to retry rather than losing the event.
    const message = err instanceof Error ? err.message : String(err)
    logger.error('webhook.pinelabs.error', { ptrid, transactionNumber, error: message })
    return NextResponse.json({ error: 'Internal error - please retry' }, { status: 500 })
  }
}
