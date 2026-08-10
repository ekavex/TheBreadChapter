import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/pos/orders/[id] — full order detail for the POS order-builder screen.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [order] = await sql`SELECT * FROM orders WHERE id = ${params.id}`
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY created_at`
    const [tableRow] = order.table_id
      ? await sql`
          SELECT t.*, s.id AS section_id_val, s.name AS section_name,
                 s.sort_order AS section_sort_order
          FROM tables t
          LEFT JOIN sections s ON s.id = t.section_id
          WHERE t.id = ${order.table_id}
        `
      : [null]
    const section = tableRow?.section_name
      ? { id: tableRow.section_id_val, name: tableRow.section_name, sort_order: tableRow.section_sort_order }
      : null
    const table = tableRow ? { ...tableRow, section } : null
    const data = { ...order, items, table }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Not found' }, { status: 404 })
  }
}
