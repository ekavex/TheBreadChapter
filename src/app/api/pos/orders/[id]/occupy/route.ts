import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

async function fetchOrderWithDetails(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`
        SELECT t.*, s.id as section_id_val, s.name as section_name, s.sort_order as section_sort_order
        FROM tables t
        LEFT JOIN sections s ON s.id = t.section_id
        WHERE t.id = ${order.table_id}
      `
    : [undefined]
  const section = tableRow?.section_name
    ? { id: tableRow.section_id_val, name: tableRow.section_name, sort_order: tableRow.section_sort_order }
    : null
  const table = tableRow?.id ? { ...tableRow, section } : null
  return { ...order, items, table }
}

// POST /api/pos/orders/[id]/occupy — manually mark the table as occupied
// Used when a waiter seats guests but hasn't added items yet.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()

    const [order] = await sql`SELECT pos_status, table_id FROM orders WHERE id = ${params.id}`

    if (!order) {
      return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    }
    if (order.pos_status !== 'OPEN') {
      return NextResponse.json({ data: null, error: 'Can only mark occupied for an open order' }, { status: 409 })
    }
    if (!order.table_id) {
      return NextResponse.json({ data: null, error: 'Order has no table' }, { status: 400 })
    }

    await sql`UPDATE tables SET status = 'occupied' WHERE id = ${order.table_id}`

    const updatedOrder = await fetchOrderWithDetails(params.id)
    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to mark occupied' }, { status: 500 })
  }
}
