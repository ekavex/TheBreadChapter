import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

// DELETE /api/admin/orders — wipe all orders for this cafe (admin only, for testing).
// Cascades to order_items, payments, staff_notifications, and resets table statuses.
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  try {
    const sql = getDb()

    await sql`DELETE FROM staff_notifications WHERE cafe_id = ${DEMO_CAFE_ID}`
    await sql`
      DELETE FROM payments
      WHERE order_id IN (SELECT id FROM orders WHERE cafe_id = ${DEMO_CAFE_ID})
    `
    await sql`
      DELETE FROM order_items
      WHERE order_id IN (SELECT id FROM orders WHERE cafe_id = ${DEMO_CAFE_ID})
    `
    await sql`DELETE FROM orders WHERE cafe_id = ${DEMO_CAFE_ID}`
    await sql`UPDATE tables SET status = 'free' WHERE cafe_id = ${DEMO_CAFE_ID}`

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete orders'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
