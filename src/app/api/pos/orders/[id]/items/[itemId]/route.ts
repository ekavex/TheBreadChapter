import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

async function fetchOrderWithDetails(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`SELECT t.*, s.id as section_id_val, s.name as section_name, s.sort_order as section_sort_order FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${order.table_id}`
    : [undefined]
  const section = tableRow?.section_name ? { id: tableRow.section_id_val, name: tableRow.section_name, sort_order: tableRow.section_sort_order } : null
  const table = tableRow?.id ? { ...tableRow, section } : null
  return { ...order, items, table }
}

// PATCH /api/pos/orders/[id]/items/[itemId] — set new quantity (decrease by 1 from client).
// If quantity reaches 0, the item is deleted.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { quantity } = await req.json()
    const newQty = Number(quantity)
    if (!Number.isFinite(newQty) || newQty < 0) {
      return NextResponse.json({ data: null, error: 'quantity must be a non-negative number' }, { status: 400 })
    }

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
        return NextResponse.json({ data: null, error: 'Cannot modify items already sent to barista' }, { status: 409 })
      }
    }

    if (newQty === 0) {
      await sql`DELETE FROM order_items WHERE id = ${params.itemId} AND order_id = ${params.id}`
    } else {
      const [item] = await sql`SELECT price FROM order_items WHERE id = ${params.itemId} AND order_id = ${params.id}`
      if (!item) return NextResponse.json({ data: null, error: 'Item not found' }, { status: 404 })
      await sql`UPDATE order_items SET quantity = ${newQty}, subtotal = ${newQty * item.price} WHERE id = ${params.itemId} AND order_id = ${params.id}`
    }

    const updatedOrder = await fetchOrderWithDetails(params.id)
    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

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
        return NextResponse.json({ data: null, error: 'Cannot remove items already sent to barista' }, { status: 409 })
      }
    }

    await sql`DELETE FROM order_items WHERE id = ${params.itemId} AND order_id = ${params.id}`

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
