import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/requireDashboardSession'
import { queueBillQrTicket } from '@/lib/printQueue'

// POST /api/pos/orders/[id]/reprint-bill
// Queues a thermal reprint of a customer bill (any order, any payment status)
// to the beverage-counter printer via the Android print bridge - used by the
// dashboard Orders list "Print" button. Unlike /qr-bill this isn't limited to
// orders currently awaiting payment, since it's meant for reprinting a
// historical receipt.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) {
    return NextResponse.json({ data: null, error: 'Authentication required' }, { status: 401 })
  }

  try {
    const sql = getDb()

    const [order] = await sql`SELECT * FROM orders WHERE id = ${params.id}`
    if (!order) {
      return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    }
    if (!order.total_paisa || Number(order.total_paisa) <= 0) {
      return NextResponse.json({ data: null, error: 'Order has no total to print' }, { status: 409 })
    }

    const orderItems = await sql`
      SELECT oi.quantity, oi.subtotal, oi.addons_json, mi.name
      FROM order_items oi
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE oi.order_id = ${params.id}
      ORDER BY oi.created_at
    `

    const itemsJson = orderItems.map((i: Record<string, unknown>) => ({
      name: String(i['name'] ?? ''),
      quantity: Number(i['quantity']),
      subtotal: Math.round(Number(i['subtotal'])),
      addons: ((i['addons_json'] as { name: string }[] | null) ?? []).map((a) => a.name).filter(Boolean),
    }))

    const result = await queueBillQrTicket(sql, params.id, itemsJson, sessionUser.displayName || sessionUser.userId)

    return NextResponse.json({ data: result, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to queue reprint'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
