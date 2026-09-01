import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, requireAdmin } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// DELETE /api/pos/orders/[id] - admin-only, permanent. order_items, kot_tickets
// and payments cascade automatically (FK ON DELETE CASCADE); stock_transactions
// rows keep their history but have reference_order_id cleared first since that
// FK has no cascade - deleting an order shouldn't erase the ingredient ledger.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const sql = getDb()
    const deleted = await sql.begin(async (tx) => {
      await tx`UPDATE stock_transactions SET reference_order_id = NULL WHERE reference_order_id = ${params.id}`
      const [row] = await tx`DELETE FROM orders WHERE id = ${params.id} RETURNING id`
      return row
    })

    if (!deleted) {
      return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    }
    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to delete order' }, { status: 500 })
  }
}

// PATCH /api/pos/orders/[id] - update mutable order fields (customer_note).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { customer_note } = await req.json()
    const sql = getDb()
    await sql`UPDATE orders SET customer_note = ${customer_note ?? null} WHERE id = ${params.id}`
    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}

// GET /api/pos/orders/[id] - full order detail for the POS order-builder screen.
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
