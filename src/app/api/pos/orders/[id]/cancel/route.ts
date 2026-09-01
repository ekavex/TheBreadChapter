import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/provider'
import { resolveStoreId } from '@/lib/payment/terminals'
import { logger } from '@/lib/logger'
import type { PaymentResult } from '@/lib/payment/types'

async function fetchOrderWithItems(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
    : [undefined]
  return { ...order, items, table: tableRow ?? null }
}

// POST /api/pos/orders/[id]/cancel - releases the table. Best-effort cancels
// any in-flight payment (per the state machine, only allowed before PIN entry
// on a real terminal - the mock never blocks this).
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

    // A transaction may be live on the terminal. Cancelling the order without
    // proving the money was NOT taken loses revenue silently, so the cancel is
    // refused unless Pine Labs confirms the transaction is dead.
    if (latestPayment?.plutus_ptrid && latestPayment.status === 'initiated') {
      const ctx = {
        clientId: latestPayment.client_id ?? '',
        storeId: latestPayment.store_id ?? resolveStoreId(),
      }

      let verified: PaymentResult
      try {
        verified = await paymentProvider.status(latestPayment.plutus_ptrid, ctx)
      } catch (err) {
        logger.error('payment.cancel.status_failed', {
          orderId: params.id,
          ptrid: latestPayment.plutus_ptrid,
          error: err instanceof Error ? err.message : String(err),
        })
        return NextResponse.json(
          {
            data: null,
            error:
              'Cannot cancel - the payment status could not be verified with Pine Labs. Check the terminal, then try again.',
          },
          { status: 409 }
        )
      }

      if (verified.status === 'approved') {
        return NextResponse.json(
          {
            data: null,
            error:
              'Cannot cancel - this payment was approved on the terminal. Use "Check payment status" to complete the order.',
          },
          { status: 409 }
        )
      }

      if (verified.status === 'pending') {
        logger.info('payment.cancel.start', { orderId: params.id, ptrid: latestPayment.plutus_ptrid })
        let cancelResult: PaymentResult
        try {
          cancelResult = await paymentProvider.cancel(
            latestPayment.plutus_ptrid,
            latestPayment.amount_paisa,
            ctx
          )
        } catch (err) {
          logger.error('payment.cancel.error', {
            orderId: params.id,
            ptrid: latestPayment.plutus_ptrid,
            error: err instanceof Error ? err.message : String(err),
          })
          return NextResponse.json(
            {
              data: null,
              error:
                'Cannot cancel - the transaction is still open on the terminal and could not be cancelled. Clear it on the terminal first.',
            },
            { status: 409 }
          )
        }

        if (cancelResult.status !== 'cancelled') {
          return NextResponse.json(
            {
              data: null,
              error: `Cannot cancel - Pine Labs returned "${cancelResult.status}" for the open transaction. Clear it on the terminal first.`,
            },
            { status: 409 }
          )
        }
        logger.info('payment.cancel.success', { orderId: params.id, ptrid: latestPayment.plutus_ptrid })
      }

      // Confirmed dead (declined / cancelled) - record it and proceed.
      await sql`UPDATE payments SET status = 'cancelled' WHERE id = ${latestPayment.id}`
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
