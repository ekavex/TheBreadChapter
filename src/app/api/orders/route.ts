import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { Order } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      cafeId, tableId, items,
      paymentMethod, notes,
      subtotal, taxAmount, totalAmount,
    } = body

    const sql = getDb()

    // Create the order
    const [order] = await sql`
      INSERT INTO orders (
        cafe_id, table_id, order_number, status, payment_method, payment_status,
        subtotal, tax_amount, service_charge, discount_amount, total_amount, notes
      )
      VALUES (
        ${cafeId},
        ${tableId},
        ${'ORD-' + Date.now().toString().slice(-4)},
        'pending',
        ${paymentMethod},
        'pending',
        ${subtotal},
        ${taxAmount},
        ${0},
        ${0},
        ${totalAmount},
        ${notes || null}
      )
      RETURNING *
    `

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

    await sql`INSERT INTO order_items ${sql(orderItems)}`

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
    const sql = getDb()

    const now = new Date().toISOString()
    const updateData: Record<string, unknown> = { status }
    if (status === 'confirmed') updateData.confirmed_at = now
    if (status === 'ready')     updateData.ready_at = now
    if (status === 'served')    updateData.served_at = now
    if (status === 'completed') updateData.completed_at = now

    const [data] = await sql`UPDATE orders SET ${sql(updateData)} WHERE id = ${orderId} RETURNING *`

    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ data: null, error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cafeId = searchParams.get('cafeId')
  const kitchen = searchParams.get('kitchen') === 'true'
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  try {
    const sql = getDb()
    const orders = kitchen
      ? await sql`
          SELECT * FROM orders
          WHERE cafe_id = ${cafeId}
            AND status IN ('pending', 'confirmed', 'making', 'ready')
            AND pos_status != 'OPEN'
          ORDER BY created_at ASC
        `
      : await sql`
          SELECT * FROM orders
          WHERE cafe_id = ${cafeId}
            AND created_at >= ${date + 'T00:00:00'}
            AND created_at <= ${date + 'T23:59:59'}
          ORDER BY created_at DESC
        `

    if (orders.length === 0) return NextResponse.json({ data: [], error: null })

    const ordArr = orders as unknown as { id: string; table_id?: string }[]
    const orderIds = ordArr.map((o) => o.id)
    const allItems = await sql`SELECT * FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])`
    const itemArr = allItems as unknown as { order_id: string }[]

    const tableIds = ordArr.map((o) => o.table_id).filter(Boolean) as string[]
    const tableRows = tableIds.length
      ? await sql`SELECT id, number, label FROM tables WHERE id = ANY(${sql.array(tableIds)}::uuid[])`
      : []
    const tableMap = Object.fromEntries((tableRows as unknown as { id: string }[]).map((t) => [t.id, t]))

    const data = ordArr.map((order) => ({
      ...order,
      items: itemArr.filter((i) => i.order_id === order.id),
      table: order.table_id ? tableMap[order.table_id] ?? null : null,
    }))

    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
