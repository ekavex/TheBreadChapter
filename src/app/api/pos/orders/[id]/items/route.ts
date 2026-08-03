import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// POST /api/pos/orders/[id]/items — add an item to an OPEN order. Merges into
// an existing line (same menu item, no customisation) instead of duplicating.
// Items are locked once the order moves past OPEN (KOT already sent).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { menu_item_id, quantity, customisation } = await req.json()
    const qty = Number(quantity) || 1

    if (!menu_item_id || qty <= 0) {
      return NextResponse.json({ data: null, error: 'menu_item_id and a positive quantity are required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase.from('orders').select('pos_status, table_id').eq('id', params.id).single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (order.pos_status !== 'OPEN') {
      return NextResponse.json({ data: null, error: `Items are locked — order is already ${order.pos_status}` }, { status: 409 })
    }

    const { data: menuItem, error: menuItemError } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', menu_item_id)
      .single()
    if (menuItemError || !menuItem) return NextResponse.json({ data: null, error: 'Menu item not found' }, { status: 404 })

    const note: string | null = customisation || null

    const existingLine = note
      ? null
      : (
          await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', params.id)
            .eq('menu_item_id', menu_item_id)
            .is('customisation', null)
            .maybeSingle()
        ).data

    if (existingLine) {
      const newQty = existingLine.quantity + qty
      const { error: updateError } = await supabase
        .from('order_items')
        .update({ quantity: newQty, subtotal: newQty * existingLine.price })
        .eq('id', existingLine.id)
      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase.from('order_items').insert({
        order_id: params.id,
        menu_item_id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: qty,
        customisation: note,
        subtotal: menuItem.price * qty,
        category: menuItem.category,
      })
      if (insertError) throw insertError
    }

    // Mark table occupied on first item (no-op if already occupied)
    if (order.table_id) {
      await supabase.from('tables').update({ status: 'occupied' }).eq('id', order.table_id).eq('status', 'free')
    }

    const { data: updatedOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*, items:order_items(*), table:tables(*, section:sections(*))')
      .eq('id', params.id)
      .single()
    if (fetchError) throw fetchError

    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
