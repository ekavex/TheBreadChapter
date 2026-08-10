import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { finalizeApprovedPayment } from '@/lib/payment/finalize'
import { DEMO_STORE_ID } from '@/lib/constants'
import { logger } from '@/lib/logger'
import type { Order, Payment, Terminal } from '@/lib/types'
import type { PaymentResult } from '@/lib/payment/types'

const ALLOWED_MODE_CODE: Record<'card' | 'cash' | 'upi', string> = { card: '1', cash: '2', upi: '10' }

function toJson(value: unknown) { return JSON.parse(JSON.stringify(value)) }

async function fetchOrderWithItemsAndTable(orderId: string): Promise<Order | null> {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order.table_id
    ? await sql`SELECT t.*, s.name AS section_name FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${order.table_id}`
    : [null]
  const table = tableRow ? { ...tableRow, section: tableRow.section_name ? { name: tableRow.section_name } : null } : null
  return { ...order, items, table } as unknown as Order
}

async function latestPaymentFor(orderId: string): Promise<Payment | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT * FROM payments
    WHERE order_id = ${orderId}
    ORDER BY created_at DESC
    LIMIT 1
  `
  return (rows[0] as Payment) ?? null
}

async function reconcileAwaitingPayment(
  order: Order,
  terminal: Terminal,
  customerPhone: string | null | undefined,
  customerName: string | null | undefined
) {
  const sql = getDb()
  const payment = await latestPaymentFor(order.id)

  if (!payment?.plutus_ptrid) {
    logger.warn('payment.reconcile.no_pending_payment', { orderId: order.id })
    const [failedOrderRow] = await sql`
      UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
      WHERE id = ${order.id}
      RETURNING *
    `
    const failedOrder = await fetchOrderWithItemsAndTable(order.id)
    return { order: failedOrder ?? (failedOrderRow as Order) ?? order, payment }
  }

  logger.info('payment.reconcile.start', { orderId: order.id, ptrid: payment.plutus_ptrid })
  const statusResult = await paymentProvider.status(payment.plutus_ptrid, {
    clientId: payment.client_id ?? terminal.client_id,
    storeId: payment.store_id ?? DEMO_STORE_ID,
  })
  logger.info('payment.reconcile.result', { orderId: order.id, ptrid: payment.plutus_ptrid, status: statusResult.status })

  if (statusResult.status === 'approved') {
    return finalizeApprovedPayment(order, payment, statusResult, customerPhone, customerName)
  }

  if (statusResult.status === 'pending') {
    return { order, payment }
  }

  await sql`
    UPDATE payments
    SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
        raw_response = ${sql.json(toJson(statusResult))}
    WHERE id = ${payment.id}
  `
  const failedOrder = await fetchOrderWithItemsAndTable(order.id)
  await sql`
    UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
    WHERE id = ${order.id}
  `
  return { order: failedOrder ?? order, payment: { ...payment, status: statusResult.status } as Payment }
}

// POST /api/pos/orders/[id]/pay
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json().catch(() => ({}))
    const { mode, customer_phone, customer_name } = body as {
      mode?: string
      customer_phone?: string | null
      customer_name?: string | null
    }

    const sql = getDb()
    const order = await fetchOrderWithItemsAndTable(params.id)
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })

    const [terminal] = await sql`SELECT * FROM terminals LIMIT 1`
    if (!terminal) return NextResponse.json({ data: null, error: 'No payment terminal configured' }, { status: 500 })

    if (order.pos_status === 'PAID') {
      const payment = await latestPaymentFor(order.id)
      return NextResponse.json({ data: { order, payment }, error: null })
    }

    if (order.pos_status === 'AWAITING_PAYMENT') {
      const result = await reconcileAwaitingPayment(order, terminal as Terminal, customer_phone, customer_name)
      return NextResponse.json({ data: result, error: null })
    }

    if (!['BILLED', 'PAYMENT_FAILED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot take payment on an order that is ${order.pos_status}` }, { status: 409 })
    }
    if (!mode || !['card', 'cash', 'upi'].includes(mode)) {
      return NextResponse.json({ data: null, error: 'mode must be "card", "cash" or "upi"' }, { status: 400 })
    }

    // Atomic claim — whoever's UPDATE matches first wins the charge
    const claimedRows = await sql`
      UPDATE orders SET pos_status = 'AWAITING_PAYMENT'
      WHERE id = ${params.id}
        AND pos_status = ANY(${sql.array(['BILLED', 'PAYMENT_FAILED'])})
      RETURNING *
    `

    if (!claimedRows.length) {
      const freshOrder = await fetchOrderWithItemsAndTable(params.id)
      if (freshOrder?.pos_status === 'AWAITING_PAYMENT') {
        const result = await reconcileAwaitingPayment(freshOrder, terminal as Terminal, customer_phone, customer_name)
        return NextResponse.json({ data: result, error: null })
      }
      if (freshOrder?.pos_status === 'PAID') {
        const payment = await latestPaymentFor(freshOrder.id)
        return NextResponse.json({ data: { order: freshOrder, payment }, error: null })
      }
      return NextResponse.json(
        { data: null, error: 'Payment already in progress on this order — refresh and retry' },
        { status: 409 }
      )
    }

    const claimed = { ...claimedRows[0], items: order.items, table: order.table } as Order
    const transactionNumber = `${claimed.order_number}-${Date.now()}`
    logger.info('payment.charge.start', { orderId: claimed.id, transactionNumber, amountPaisa: claimed.total_paisa, mode })

    let chargeResult: PaymentResult
    try {
      chargeResult = await paymentProvider.charge({
        transactionNumber,
        amountPaisa: claimed.total_paisa,
        allowedModes: ALLOWED_MODE_CODE[mode as 'card' | 'cash' | 'upi'],
        clientId: terminal.client_id,
        storeId: DEMO_STORE_ID,
      })
    } catch (chargeErr) {
      const message = chargeErr instanceof Error ? chargeErr.message : String(chargeErr)
      logger.error('payment.charge.error', { orderId: claimed.id, transactionNumber, error: message })
      await sql`UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed' WHERE id = ${params.id}`
      throw chargeErr
    }
    logger.info('payment.charge.result', { orderId: claimed.id, transactionNumber, ptrid: chargeResult.ptrid, status: chargeResult.status })

    const [payment] = await sql`
      INSERT INTO payments (
        order_id, transaction_number, plutus_ptrid, status, mode,
        amount_paisa, client_id, store_id, raw_response
      ) VALUES (
        ${params.id},
        ${transactionNumber},
        ${chargeResult.ptrid ?? null},
        'initiated',
        ${chargeResult.mode ?? null},
        ${claimed.total_paisa},
        ${terminal.client_id},
        ${DEMO_STORE_ID},
        ${sql.json(toJson(chargeResult))}
      )
      RETURNING *
    `

    logger.info('payment.status.start', { orderId: claimed.id, ptrid: chargeResult.ptrid })
    const statusResult = chargeResult.ptrid
      ? await paymentProvider.status(chargeResult.ptrid, { clientId: terminal.client_id, storeId: DEMO_STORE_ID })
      : chargeResult
    logger.info('payment.status.result', { orderId: claimed.id, ptrid: chargeResult.ptrid, status: statusResult.status })

    if (statusResult.status === 'approved') {
      const result = await finalizeApprovedPayment(claimed, payment as Payment, statusResult, customer_phone, customer_name)
      return NextResponse.json({ data: result, error: null })
    }

    logger.warn('payment.declined', { orderId: claimed.id, ptrid: chargeResult.ptrid, status: statusResult.status })
    await sql`
      UPDATE payments
      SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
          raw_response = ${sql.json(toJson(statusResult))}
      WHERE id = ${payment.id}
    `
    await sql`
      UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
      WHERE id = ${params.id}
    `
    const failedOrder = await fetchOrderWithItemsAndTable(params.id)
    return NextResponse.json({ data: { order: failedOrder ?? claimed, payment: { ...payment, status: statusResult.status } }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed'
    logger.error('payment.route.error', { orderId: params.id, error: message })
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
