import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, requireManagerOrAdmin, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Ingredient } from '@/lib/types'

async function recordStaffAction(userId: string, action: string, description: string) {
  const sql = getDb()
  await sql`INSERT INTO staff_notifications (cafe_id, action, description, created_by) VALUES (${DEMO_CAFE_ID}, ${action}, ${description}, ${userId})`
}

export const dynamic = 'force-dynamic'

// GET /api/ingredients — list all ingredients, with low-stock/expiry flags
// computed server-side so the UI stays presentational. Dashboard-only data —
// not part of the public customer menu API, so it's session-gated.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const data = await sql`SELECT * FROM ingredients ORDER BY name ASC`

    const ingredients = data as unknown as Ingredient[]
    const withFlags = ingredients.map((i) => ({
      ...i,
      is_low_stock: i.current_stock <= i.low_stock_threshold,
      days_to_expiry: i.expiry_date
        ? Math.ceil((new Date(i.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    }))

    return NextResponse.json({ data: withFlags, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch ingredients'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// POST /api/ingredients — add a new ingredient (manager or admin only)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const { name, unit, low_stock_threshold, cost_per_unit_paisa, is_perishable, expiry_date, current_stock } = body

    if (!name || !unit) {
      return NextResponse.json({ data: null, error: 'name and unit are required' }, { status: 400 })
    }

    const sql = getDb()
    const [data] = await sql`
      INSERT INTO ingredients (name, unit, current_stock, low_stock_threshold, cost_per_unit_paisa, is_perishable, expiry_date)
      VALUES (
        ${name},
        ${unit},
        ${current_stock ?? 0},
        ${low_stock_threshold ?? 0},
        ${cost_per_unit_paisa ?? 0},
        ${is_perishable ?? false},
        ${expiry_date ?? null}
      )
      RETURNING *
    `

    const user = await getSessionUser(req)
    if (user && user.role !== 'admin') {
      const who = user.displayName || user.userId
      await recordStaffAction(user.userId, 'ingredient_added', `${who} added ingredient: "${name}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create ingredient'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
