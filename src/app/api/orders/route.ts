import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import type { Order } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      cafeId, tableId, items,
      paymentMethod, notes,
      subtotal, taxAmount, totalAmount,
    } = body

    const supabase = createAdminClient()

    // Create the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        cafe_id: cafeId,
        table_id: tableId,
        order_number: `ORD-${Date.now().toString().slice(-4)}`,
        status: 'pending',
        payment_method: paymentMethod,
        payment_status: paymentMethod === 'cash' ? 'pending' : 'pending',
        subtotal,
        tax_amount: taxAmount,
        service_charge: 0,
        discount_amount: 0,
        total_amount: totalAmount,
        notes: notes || null,
      })
      .select()
      .single()

    if (orderError) throw orderError

    // Insert order items
    const orderItems = items.map((item: any) => ({
      order_id: order.id,
      menu_item_id: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      customisation: item.customisation || null,
      subtotal: item.price * item.quantity,
      status: 'pending',
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) throw itemsError

    // TODO Phase 2: Send WhatsApp confirmation to customer
    // await sendWhatsAppConfirmation(order, items)

    return NextResponse.json({ data: order, error: null })
  } catch (err: any) {
    console.error('[POST /api/orders]', err)
    return NextResponse.json({ data: null, error: err.message }, { status: 500 })
  }
}

// Update order status — called by kitchen dashboard
export async function PATCH(req: NextRequest) {
  try {
    const { orderId, status } = await req.json()
    const supabase = createAdminClient()

    // Omit the UI-only joined fields (`items`, `table`) — not real columns,
    // so they can't be part of an .update() payload.
    const updateData: Partial<Omit<Order, 'items' | 'table'>> = { status }
    if (status === 'confirmed') updateData.confirmed_at = new Date().toISOString()
    if (status === 'ready')     updateData.ready_at = new Date().toISOString()
    if (status === 'served')    updateData.served_at = new Date().toISOString()
    if (status === 'completed') updateData.completed_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ data: null, error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cafeId = searchParams.get('cafeId')
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*), table:tables(number,label)')
    .eq('cafe_id', cafeId)
    .gte('created_at', `${date}T00:00:00`)
    .lte('created_at', `${date}T23:59:59`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}
