import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

async function fetchFullOrder(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
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
  return { ...order, items, table }
}

// POST /api/pos/orders — Module 5 "Order Entry (POS)":
// waiter taps a table → if free, opens a new order and marks it occupied;
// if already occupied/kot_sent/billed, resumes the existing open order
// instead of creating a duplicate.
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { tableId } = await req.json()
    if (!tableId) return NextResponse.json({ data: null, error: 'tableId is required' }, { status: 400 })

    const sql = getDb()
    const [table] = await sql`SELECT * FROM tables WHERE id = ${tableId}`
    if (!table) return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 })

    // Resume any existing open order regardless of table status
    const existingRows = await sql`
      SELECT id FROM orders
      WHERE table_id = ${tableId}
        AND pos_status NOT IN ('PAID', 'CANCELLED')
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (existingRows.length) {
      const existing = await fetchFullOrder(existingRows[0].id as string)
      return NextResponse.json({ data: existing, error: null })
    }

    // No open order — table must be free to create one
    if (table.status !== 'free') {
      return NextResponse.json(
        { data: null, error: `Table is marked ${table.status} but has no open order — data inconsistency, check manually` },
        { status: 409 }
      )
    }

    const [{ order_number: orderNumber }] = await sql`
      SELECT generate_order_number(${DEMO_CAFE_ID}::uuid) AS order_number
    `

    // Create the order — table stays 'free' until the first item is added
    const [order] = await sql`
      INSERT INTO orders (cafe_id, table_id, order_number, status, pos_status)
      VALUES (${DEMO_CAFE_ID}, ${tableId}, ${orderNumber}, 'pending', 'OPEN')
      RETURNING *
    `

    const full = await fetchFullOrder(order.id as string)
    return NextResponse.json({ data: full, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to open order'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
