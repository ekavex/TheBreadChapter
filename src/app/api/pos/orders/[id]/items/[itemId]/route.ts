import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// DELETE /api/pos/orders/[id]/items/[itemId] — remove a line.
// When OPEN: any item can be removed.
// When KOT_SENT: only add-on items (created after kot_sent_at) can be removed.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [order] = await sql`SELECT pos_status, kot_sent_at FROM orders WHERE id = ${params.id}`
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })

    if (!['OPEN', 'KOT_SENT'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Items are locked — order is already ${order.pos_status}` }, { status: 409 })
    }

    if (order.pos_status === 'KOT_SENT' && order.kot_sent_at) {
      const [item] = await sql`SELECT created_at FROM order_items WHERE id = ${params.itemId} AND order_id = ${params.id}`
      if (!item) return NextResponse.json({ data: null, error: 'Item not found' }, { status: 404 })
      if (new Date(item.created_at) <= new Date(order.kot_sent_at)) {
        return NextResponse.json({ data: null, error: 'Cannot remove items already sent to kitchen' }, { status: 409 })
      }
    }

    await sql`DELETE FROM order_items WHERE id = ${params.itemId} AND order_id = ${params.id}`

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
