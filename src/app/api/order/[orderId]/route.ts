import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Public GET - customer-facing order tracker polls this to get live status.
// No auth required; only exposes status fields, not financial data.
export async function GET(_req: NextRequest, { params }: { params: { orderId: string } }) {
  try {
    const sql = getDb()
    const [order] = await sql`
      SELECT id, status, pos_status, order_number, created_at
      FROM orders WHERE id = ${params.orderId}
    `
    if (!order) return NextResponse.json({ data: null, error: 'Not found' }, { status: 404 })

    const items = await sql`
      SELECT id, name, quantity, status FROM order_items WHERE order_id = ${params.orderId} ORDER BY created_at
    `

    return NextResponse.json({ data: { ...order, items }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
