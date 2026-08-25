import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

async function recordStaffAction(userId: string, action: string, description: string) {
  const sql = getDb()
  await sql`INSERT INTO staff_notifications (cafe_id, action, description, created_by) VALUES (${DEMO_CAFE_ID}, ${action}, ${description}, ${userId})`
}

// POST /api/menu/categories — Add menu category (staff action logged)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const { name, name_hi, description, sort_order } = body

    if (!name) {
      return NextResponse.json({ data: null, error: 'name is required' }, { status: 400 })
    }

    const sql = getDb()
    const [data] = await sql`
      INSERT INTO menu_categories (cafe_id, name, name_hi, description, sort_order)
      VALUES (
        ${DEMO_CAFE_ID},
        ${name},
        ${name_hi || null},
        ${description || null},
        ${sort_order ?? 0}
      )
      RETURNING *
    `

    const user = await getSessionUser(req)
    if (user && user.role !== 'admin') {
      const who = user.displayName || user.userId
      await recordStaffAction(user.userId, 'category_added', `${who} added a new menu category: "${name}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create category'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
