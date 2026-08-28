import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

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

// POST /api/pos/orders/[id]/items — add an item to an OPEN order. Merges into
// an existing line (same menu item, no customisation) instead of duplicating.
// Items are locked once the order moves past OPEN (KOT already sent).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { menu_item_id, quantity, customisation, addons, variant } = await req.json()
    const qty = Number(quantity) || 1

    if (!menu_item_id || qty <= 0) {
      return NextResponse.json({ data: null, error: 'menu_item_id and a positive quantity are required' }, { status: 400 })
    }

    const sql = getDb()
    const [order] = await sql`SELECT pos_status, table_id FROM orders WHERE id = ${params.id}`
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (!['OPEN', 'KOT_SENT'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Items are locked — order is already ${order.pos_status}` }, { status: 409 })
    }

    const [menuItem] = await sql`SELECT * FROM menu_items WHERE id = ${menu_item_id}`
    if (!menuItem) return NextResponse.json({ data: null, error: 'Menu item not found' }, { status: 404 })

    const note: string | null = customisation || null
    const addonsList: { id: string; name: string; price: number }[] = Array.isArray(addons) ? addons : []
    const addonTotal = addonsList.reduce((s, a) => s + (Number(a.price) || 0), 0)
    const hasAddons = addonsList.length > 0

    // When a variant is selected, use its label (appended to name) and price
    const hasVariant = variant && typeof variant.label === 'string' && typeof variant.price === 'number'
    const itemName = hasVariant ? `${menuItem.name} (${variant.label})` : menuItem.name
    const basePrice = hasVariant ? Number(variant.price) : Number(menuItem.price)

    // When KOT is already sent, never merge into an existing line — always create
    // a new row with a fresh created_at so the frontend can diff "sent vs add-on".
    // Also never merge variant items (different variants are separate lines).
    const [existingLine] = (note || hasAddons || hasVariant || order.pos_status === 'KOT_SENT')
      ? [undefined]
      : await sql`SELECT * FROM order_items WHERE order_id = ${params.id} AND menu_item_id = ${menu_item_id} AND customisation IS NULL AND (addons_json = '[]' OR addons_json IS NULL) LIMIT 1`

    if (existingLine) {
      const newQty = existingLine.quantity + qty
      await sql`UPDATE order_items SET quantity = ${newQty}, subtotal = ${newQty * existingLine.price} WHERE id = ${existingLine.id}`
    } else {
      const unitPrice = basePrice + addonTotal
      await sql`
        INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, customisation, subtotal, category, addons_json)
        VALUES (
          ${params.id},
          ${menu_item_id},
          ${itemName},
          ${basePrice},
          ${qty},
          ${note},
          ${unitPrice * qty},
          ${menuItem.category},
          ${sql.json(addonsList.map(a => ({ id: a.id, name: a.name, price: a.price })))}
        )
      `
    }

    // Mark table occupied on first item (no-op if already occupied)
    if (order.table_id) {
      await sql`UPDATE tables SET status = 'occupied' WHERE id = ${order.table_id} AND status = 'free'`
    }

    const updatedOrder = await fetchOrderWithDetails(params.id)
    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
