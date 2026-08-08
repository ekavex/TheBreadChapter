// POST /api/webhooks/pinelabs
//
// Pine Labs pushes payment results here (Post Back URL — register this with
// Pine Labs during onboarding). The body is application/x-www-form-urlencoded
// but the *value* is a single comma-joined "key=value" CSV string — NOT
// standard URL-encoded form fields (see PINELABS_INTEGRATION_MASTER.md §6).
//
// Security posture:
//   • This endpoint has NO session guard — Pine Labs calls it server-to-server.
//   • We NEVER trust the postback alone for money decisions.
//   • After parsing, we always re-verify via GetStatus (provider.status) before
//     finalizing. The postback is only a wake-up signal.
//   • Response must be 200 quickly so Pine Labs doesn't retry indefinitely.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { finalizeApprovedPayment } from '@/lib/payment/finalize'
import { logger } from '@/lib/logger'
import { DEMO_STORE_ID } from '@/lib/constants'
import type { Order, Payment } from '@/lib/types'

const ORDER_WITH_ITEMS_AND_TABLE = '*, items:order_items(*), table:tables(*)'

// Pine Labs postback is a comma-joined "key=value" string, NOT a standard
// URL-encoded body. Parse it into a plain object.
function parsePostBack(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const key = pair.slice(0, eq).trim()
    const val = pair.slice(eq + 1).trim()
    result[key] = val
  }
  return result
}

export async function POST(req: NextRequest) {
  let rawBody = ''
  try {
    // Pine Labs sends application/x-www-form-urlencoded but the CSV payload
    // is the raw text — read it as text to preserve the format.
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Could not read body' }, { status: 400 })
  }

  // The body may arrive as "ResponseCode=0,ResponseMessage=APPROVED,..." directly
  // or URL-encoded as a form field. Handle both.
  let csvPayload = rawBody
  if (rawBody.includes('%3D') || rawBody.startsWith('data=') || rawBody.includes('&')) {
    // Standard URL-encoded — decode and extract the CSV value
    const params = new URLSearchParams(rawBody)
    csvPayload = params.get('data') ?? params.get('postback') ?? rawBody
  }

  const fields = parsePostBack(decodeURIComponent(csvPayload))

  const ptrid             = fields['PlutusTransactionReferenceID']
  const transactionNumber = fields['TransactionNumber']
  const postbackCode      = Number(fields['ResponseCode'] ?? '-1')

  logger.info('webhook.pinelabs.received', {
    ptrid,
    transactionNumber,
    responseCode: postbackCode,
    responseMessage: fields['ResponseMessage'],
  })

  if (!ptrid && !transactionNumber) {
    logger.warn('webhook.pinelabs.unidentifiable', { raw: rawBody.slice(0, 200) })
    return NextResponse.json({ ok: true }) // ack so Pine Labs doesn't retry
  }

  try {
    const supabase = createAdminClient()

    // Find the payment row — try by PTRID first, fall back to TransactionNumber
    const { data: paymentRaw } = await supabase
      .from('payments')
      .select('*')
      .or(
        [
          ptrid             ? `plutus_ptrid.eq.${ptrid}`                       : '',
          transactionNumber ? `transaction_number.eq.${transactionNumber}` : '',
        ]
          .filter(Boolean)
          .join(',')
      )
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!paymentRaw) {
      logger.warn('webhook.pinelabs.payment_not_found', { ptrid, transactionNumber })
      return NextResponse.json({ ok: true })
    }
    const payment = paymentRaw as Payment

    // Find the order
    const { data: orderRaw } = await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_AND_TABLE)
      .eq('id', payment.order_id)
      .single()
    if (!orderRaw) {
      logger.warn('webhook.pinelabs.order_not_found', { orderId: payment.order_id })
      return NextResponse.json({ ok: true })
    }
    const order = orderRaw as Order

    // Already in a terminal state — nothing to do
    if (['PAID', 'CANCELLED'].includes(order.pos_status)) {
      logger.info('webhook.pinelabs.already_terminal', { orderId: order.id, posStatus: order.pos_status })
      return NextResponse.json({ ok: true })
    }

    // Re-verify with GetStatus — NEVER trust the postback amount/mode directly
    const resolvedPtrid = ptrid ?? payment.plutus_ptrid
    if (!resolvedPtrid) {
      logger.warn('webhook.pinelabs.no_ptrid', { orderId: order.id })
      return NextResponse.json({ ok: true })
    }

    const statusResult = await paymentProvider.status(resolvedPtrid, {
      clientId: payment.client_id ?? '',
      storeId:  payment.store_id  ?? DEMO_STORE_ID,
    })

    logger.info('webhook.pinelabs.status_verified', {
      orderId: order.id,
      ptrid:   resolvedPtrid,
      status:  statusResult.status,
    })

    if (statusResult.status === 'approved') {
      await finalizeApprovedPayment(supabase, order, payment, statusResult, null, null)
      logger.info('webhook.pinelabs.finalized', { orderId: order.id })
      return NextResponse.json({ ok: true })
    }

    // Declined or cancelled — mark the order as failed so the waiter can retry
    if (statusResult.status === 'declined' || statusResult.status === 'cancelled') {
      const toJson = (v: unknown) => JSON.parse(JSON.stringify(v))
      await supabase
        .from('payments')
        .update({
          status:       statusResult.status === 'cancelled' ? 'cancelled' : 'declined',
          raw_response: toJson(statusResult),
        })
        .eq('id', payment.id)

      await supabase
        .from('orders')
        .update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' })
        .eq('id', order.id)

      logger.info('webhook.pinelabs.failed', { orderId: order.id, status: statusResult.status })
    }

    // 'pending' — terminal hasn't settled yet; do nothing, let polling handle it
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('webhook.pinelabs.error', { ptrid, transactionNumber, error: message })
    // Still return 200 — a 500 would make Pine Labs retry the same webhook
    return NextResponse.json({ ok: true })
  }
}
