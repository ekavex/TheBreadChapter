import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { rupeesToPaisa } from '@/lib/money'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { CafeSettings } from '@/lib/types'

async function fetchOrderWithItems(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
    : [undefined]
  return { ...order, items, table: tableRow ?? null }
}

// POST /api/pos/orders/[id]/bill — Module 5 "Bill Generation & Printing":
// itemised total, table → billed. Safe to re-generate while still BILLED
// (e.g. a network retry) — recomputes from current order_items either way.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const rows = await sql`SELECT * FROM orders WHERE id = ${params.id}`
    const order = rows[0] as unknown as { pos_status: string; table_id: string | null } | undefined
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (!['KOT_SENT', 'BILLED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot bill an order that is ${order.pos_status}` }, { status: 409 })
    }

    const orderItems = await sql`SELECT * FROM order_items WHERE order_id = ${params.id}` as unknown as { subtotal: number }[]
    const subtotal = orderItems.reduce((sum: number, i) => sum + i.subtotal, 0)

    const [cafe] = await sql`SELECT settings FROM cafes WHERE id = ${DEMO_CAFE_ID}`
    const settings = (cafe as unknown as { settings: unknown } | undefined)?.settings as CafeSettings | undefined
    const taxPercent = settings?.tax_percent ?? 0
    const serviceChargePercent = settings?.service_charge_percent ?? 0
    const taxAmount = Math.round(subtotal * taxPercent) / 100
    const serviceCharge = Math.round(subtotal * serviceChargePercent) / 100
    const totalAmount = subtotal + taxAmount + serviceCharge
    const totalPaisa = rupeesToPaisa(totalAmount)

    if (order.pos_status === 'KOT_SENT' && order.table_id) {
      await sql`UPDATE tables SET status = 'billed' WHERE id = ${order.table_id}`
    }

    const now = new Date().toISOString()
    await sql`
      UPDATE orders
      SET subtotal = ${subtotal},
          tax_amount = ${taxAmount},
          service_charge = ${serviceCharge},
          total_amount = ${totalAmount},
          total_paisa = ${totalPaisa},
          pos_status = 'BILLED',
          billed_at = ${now}
      WHERE id = ${params.id}
    `

    const updatedOrder = await fetchOrderWithItems(params.id)
    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate bill'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
