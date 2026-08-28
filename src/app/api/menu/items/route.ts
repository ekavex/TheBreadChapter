import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

async function recordStaffAction(userId: string, action: string, description: string) {
  const sql = getDb()
  await sql`INSERT INTO staff_notifications (cafe_id, action, description, created_by) VALUES (${DEMO_CAFE_ID}, ${action}, ${description}, ${userId})`
}

// POST /api/menu/items — Add menu item (manager or admin only; change is logged to admin)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const {
      category_id, name, name_hi, description, price, category,
      is_veg, is_vegan, is_jain, contains_gluten, contains_nuts,
      spice_level, prep_time_mins, variants,
    } = body

    if (!category_id || !name || price === undefined || price === null) {
      return NextResponse.json({ data: null, error: 'category_id, name and price are required' }, { status: 400 })
    }
    if (!['food', 'beverage'].includes(category)) {
      return NextResponse.json({ data: null, error: 'category must be "food" or "beverage"' }, { status: 400 })
    }

    const variantsList = Array.isArray(variants) && variants.length > 0 ? variants : null

    const sql = getDb()
    const [data] = await sql`
      INSERT INTO menu_items (
        cafe_id, category_id, name, name_hi, description, price, category,
        is_veg, is_vegan, is_jain, contains_gluten, contains_nuts, spice_level, prep_time_mins, variants
      )
      VALUES (
        ${DEMO_CAFE_ID},
        ${category_id},
        ${name},
        ${name_hi || null},
        ${description || null},
        ${Number(price)},
        ${category},
        ${is_veg ?? true},
        ${is_vegan ?? false},
        ${is_jain ?? false},
        ${contains_gluten ?? true},
        ${contains_nuts ?? false},
        ${spice_level ?? 0},
        ${prep_time_mins ?? 10},
        ${variantsList ? sql.json(variantsList) : null}
      )
      RETURNING *
    `

    const user = await getSessionUser(req)
    if (user && user.role !== 'admin') {
      const who = user.displayName || user.userId
      await recordStaffAction(user.userId, 'item_added', `${who} added a new menu item: "${name}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
