import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/requireDashboardSession'
import { queueBillQrTicket } from '@/lib/printQueue'

// POST /api/pos/orders/[id]/qr-bill
// Queues a bill_qr print job to the beverage counter printer.
// The Android APK picks it up within 3 s and prints a thermal bill with
// a pre-filled UPI QR code. After the customer pays, the waiter calls
// POST /pay with mode=upi_qr to mark the order PAID.
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

    if (!['BILLED', 'PAYMENT_FAILED', 'AWAITING_PAYMENT'].includes(order.pos_status as string)) {
      return NextResponse.json(
        { data: null, error: `Cannot print QR bill for an order that is ${order.pos_status}` },
        { status: 409 },
      )
    }

    if (!order.total_paisa || Number(order.total_paisa) <= 0) {
      return NextResponse.json(
        { data: null, error: 'Order total is zero - regenerate the bill before printing QR' },
        { status: 409 },
      )
    }

    // Fetch bill items with subtotals for the printed receipt.
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
    const message = err instanceof Error ? err.message : 'Failed to queue QR bill'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
