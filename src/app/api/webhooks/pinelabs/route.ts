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
import { getDb } from '@/lib/db'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { finalizeApprovedPayment } from '@/lib/payment/finalize'
import { logger } from '@/lib/logger'
import { DEMO_STORE_ID } from '@/lib/constants'
import type { Order, Payment } from '@/lib/types'

function parsePostBack(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return result
}

export async function POST(req: NextRequest) {
  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Could not read body' }, { status: 400 })
  }

  let csvPayload = rawBody
  if (rawBody.includes('%3D') || rawBody.startsWith('data=') || rawBody.includes('&')) {
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

    if (['PAID', 'CANCELLED'].includes(order.pos_status)) {
      logger.info('webhook.pinelabs.already_terminal', { orderId: order.id, posStatus: order.pos_status })
      return NextResponse.json({ ok: true })
    }

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
      await finalizeApprovedPayment(order, payment, statusResult, null, null)
      logger.info('webhook.pinelabs.finalized', { orderId: order.id })
      return NextResponse.json({ ok: true })
    }

    if (statusResult.status === 'declined' || statusResult.status === 'cancelled') {
      const toJson = (v: unknown) => JSON.parse(JSON.stringify(v))
      await sql`
        UPDATE payments
        SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
            raw_response = ${sql.json(toJson(statusResult))}
        WHERE id = ${payment.id}
      `
      await sql`
        UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
        WHERE id = ${order.id}
      `
      logger.info('webhook.pinelabs.failed', { orderId: order.id, status: statusResult.status })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('webhook.pinelabs.error', { ptrid, transactionNumber, error: message })
    return NextResponse.json({ ok: true })
  }
}
