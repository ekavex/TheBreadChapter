import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { DEMO_STORE_ID } from '@/lib/constants'
import { logger } from '@/lib/logger'

async function fetchOrderWithItems(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
    : [undefined]
  return { ...order, items, table: tableRow ?? null }
}

// POST /api/pos/orders/[id]/cancel — releases the table. Best-effort cancels
// any in-flight payment (per the state machine, only allowed before PIN entry
// on a real terminal — the mock never blocks this).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [order] = await sql`SELECT * FROM orders WHERE id = ${params.id}`
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (['PAID', 'CANCELLED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot cancel an order that is already ${order.pos_status}` }, { status: 409 })
    }

    const payments = await sql`
      SELECT * FROM payments WHERE order_id = ${params.id} ORDER BY created_at DESC LIMIT 1
    `
    const latestPayment = payments[0] ?? null

    if (latestPayment?.plutus_ptrid && latestPayment.status === 'initiated') {
      logger.info('payment.cancel.start', { orderId: params.id, ptrid: latestPayment.plutus_ptrid })
      try {
        await paymentProvider.cancel(latestPayment.plutus_ptrid, latestPayment.amount_paisa, {
          clientId: latestPayment.client_id ?? '',
          storeId: latestPayment.store_id ?? DEMO_STORE_ID,
        })
        await sql`UPDATE payments SET status = 'cancelled' WHERE id = ${latestPayment.id}`
        logger.info('payment.cancel.success', { orderId: params.id, ptrid: latestPayment.plutus_ptrid })
      } catch (err) {
        // best-effort — proceed with cancelling the order regardless
        logger.error('payment.cancel.error', {
          orderId: params.id,
          ptrid: latestPayment.plutus_ptrid,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    await sql`UPDATE tables SET status = 'free' WHERE id = ${order.table_id}`

    await sql`UPDATE orders SET pos_status = 'CANCELLED', status = 'cancelled' WHERE id = ${params.id}`

    const cancelledOrder = await fetchOrderWithItems(params.id)
    return NextResponse.json({ data: cancelledOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel order'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
