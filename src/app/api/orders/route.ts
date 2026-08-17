import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { rupeesToPaisa } from '@/lib/money'
import { logger } from '@/lib/logger'
import type { CafeSettings, Order, OrderStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_QTY_PER_LINE = 50
const MAX_LINES = 50
const MAX_CUSTOMISATION_CHARS = 200

interface IncomingLine { menuItemId?: string; quantity?: number; customisation?: string | null }

// POST /api/orders — customer QR flow. Unauthenticated by nature (the customer
// has no login), so NOTHING price-related from the request body is trusted:
// names, prices, tax and totals are all recomputed from the database.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { cafeId, tableId, items, paymentMethod, notes } = body as {
      cafeId?: string
      tableId?: string
      items?: IncomingLine[]
      paymentMethod?: string
      notes?: string
    }

    if (!cafeId || !tableId) {
      return NextResponse.json({ data: null, error: 'cafeId and tableId are required' }, { status: 400 })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ data: null, error: 'At least one item is required' }, { status: 400 })
    }
    if (items.length > MAX_LINES) {
      return NextResponse.json({ data: null, error: 'Too many items in one order' }, { status: 400 })
    }
    const method = paymentMethod === 'cash' ? 'cash' : paymentMethod === 'upi' ? 'upi' : 'unpaid'

    const sql = getDb()

    const [cafe] = await sql`SELECT id, settings FROM cafes WHERE id = ${cafeId} AND is_active = true`
    if (!cafe) return NextResponse.json({ data: null, error: 'Cafe not found' }, { status: 404 })

    const [table] = await sql`
      SELECT id FROM tables WHERE id = ${tableId} AND cafe_id = ${cafeId} AND is_active = true
    `
    if (!table) return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 })

    // Resolve every line against the live menu — price comes from the DB only.
    const requestedIds = Array.from(
      new Set(items.map((i) => i.menuItemId).filter((id): id is string => typeof id === 'string' && id.length > 0))
    )
    if (requestedIds.length === 0) {
      return NextResponse.json({ data: null, error: 'Invalid items' }, { status: 400 })
    }

    const menuRows = await sql`
      SELECT id, name, price, category, is_available
      FROM menu_items
      WHERE id = ANY(${sql.array(requestedIds)}::uuid[]) AND cafe_id = ${cafeId}
    `
    const menuById = new Map(
      (menuRows as unknown as { id: string; name: string; price: number; category: string; is_available: boolean }[])
        .map((m) => [m.id, m])
    )

    const priced: {
      menu_item_id: string
      name: string
      price: number
      quantity: number
      customisation: string | null
      subtotal: number
      category: string
      status: string
    }[] = []

    for (const line of items) {
      const menuItem = line.menuItemId ? menuById.get(line.menuItemId) : undefined
      if (!menuItem) {
        return NextResponse.json({ data: null, error: 'One or more items are no longer on the menu' }, { status: 400 })
      }
      if (!menuItem.is_available) {
        return NextResponse.json({ data: null, error: `${menuItem.name} is currently unavailable` }, { status: 409 })
      }
      const qty = Math.floor(Number(line.quantity))
      if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
        return NextResponse.json({ data: null, error: 'Invalid quantity' }, { status: 400 })
      }
      const customisation =
        typeof line.customisation === 'string' && line.customisation.trim()
          ? line.customisation.trim().slice(0, MAX_CUSTOMISATION_CHARS)
          : null

      priced.push({
        menu_item_id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: qty,
        customisation,
        subtotal: menuItem.price * qty,
        category: menuItem.category,
        status: 'pending',
      })
    }

    const settings = (cafe as unknown as { settings: CafeSettings | null }).settings
    const taxPercent = Number(settings?.tax_percent ?? 0)
    const serviceChargePercent = Number(settings?.service_charge_percent ?? 0)

    const subtotal = priced.reduce((sum, l) => sum + l.subtotal, 0)
    const taxAmount = Math.round(subtotal * taxPercent) / 100
    const serviceCharge = Math.round(subtotal * serviceChargePercent) / 100
    const totalAmount = subtotal + taxAmount + serviceCharge

    const [{ order_number: orderNumber }] = await sql`
      SELECT generate_order_number(${cafeId}::uuid) AS order_number
    `

    const order = await sql.begin(async (tx) => {
      const [created] = await tx`
        INSERT INTO orders (
          cafe_id, table_id, order_number, status, payment_method, payment_status,
          subtotal, tax_amount, service_charge, discount_amount, total_amount, total_paisa, notes
        )
        VALUES (
          ${cafeId},
          ${tableId},
          ${orderNumber},
          'pending',
          ${method},
          'pending',
          ${subtotal},
          ${taxAmount},
          ${serviceCharge},
          ${0},
          ${totalAmount},
          ${rupeesToPaisa(totalAmount)},
          ${typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null}
        )
        RETURNING *
      `
      await tx`INSERT INTO order_items ${tx(priced.map((l) => ({ ...l, order_id: created.id })))}`
      return created
    })

    logger.info('order.created.customer', {
      orderId: order.id,
      orderNumber,
      tableId,
      lines: priced.length,
      totalAmount,
    })

    return NextResponse.json({ data: order, error: null })
  } catch (err) {
    logger.error('order.create.error', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ data: null, error: 'Could not place order' }, { status: 500 })
  }
}

const ALLOWED_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'making', 'ready', 'served', 'completed', 'cancelled']

// Update order status — called by the kitchen display. Staff session required.
export async function PATCH(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { orderId, status } = await req.json()
    if (!orderId || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ data: null, error: 'orderId and a valid status are required' }, { status: 400 })
    }
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

// Full order data (totals, customers, items) — staff session required.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const { searchParams } = new URL(req.url)
  const cafeId = searchParams.get('cafeId')
  const kitchen = searchParams.get('kitchen') === 'true'
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  try {
    const sql = getDb()
    // The kitchen display polls this every few seconds on a tablet — send only
    // the columns it renders, and cap the board so one bad day cannot turn the
    // poll into a full table scan dump.
    const orders = kitchen
      ? await sql`
          SELECT id, order_number, status, pos_status, table_id, notes, created_at, confirmed_at
          FROM orders
          WHERE cafe_id = ${cafeId}
            AND status IN ('pending', 'confirmed', 'making', 'ready')
            AND pos_status != 'OPEN'
          ORDER BY created_at ASC
          LIMIT 100
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
    const allItems = kitchen
      ? await sql`
          SELECT id, order_id, name, quantity, customisation, status, category
          FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[]) ORDER BY created_at
        `
      : await sql`SELECT * FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])`
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
