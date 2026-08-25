import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// POST /api/pos/orders/[id]/qr-bill
// Queues a bill_qr print job to the beverage counter printer.
// The Android APK picks it up within 3 s and prints a thermal bill with
// a pre-filled UPI QR code. After the customer pays, the waiter calls
// POST /pay with mode=upi_qr to mark the order PAID.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

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
      { data: null, error: 'Order total is zero — regenerate the bill before printing QR' },
      { status: 409 },
    )
  }

  // Fetch bill items with subtotals for the printed receipt.
  const orderItems = await sql`
    SELECT oi.quantity, oi.subtotal, mi.name
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = ${params.id}
    ORDER BY oi.created_at
  `

  const itemsJson = orderItems.map((i: Record<string, unknown>) => ({
    name: String(i['name'] ?? ''),
    quantity: Number(i['quantity']),
    subtotal: Math.round(Number(i['subtotal'])),
  }))

  await sql`
    INSERT INTO kot_tickets (order_id, station, items_json, print_status, job_type)
    VALUES (
      ${params.id},
      'beverage_counter',
      ${sql.json(itemsJson)},
      'queued',
      'bill_qr'
    )
  `

  return NextResponse.json({ data: { ok: true }, error: null })
}
