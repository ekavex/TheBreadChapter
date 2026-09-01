import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// GET /api/menu/addons - list all add-ons for this cafe
export async function GET(req: NextRequest) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  try {
    const sql = getDb()
    const rows = await sql`SELECT * FROM addons WHERE cafe_id = ${DEMO_CAFE_ID} ORDER BY sort_order ASC, created_at ASC`
    return NextResponse.json({ data: rows, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to load add-ons' }, { status: 500 })
  }
}

// POST /api/menu/addons - create a new add-on
export async function POST(req: NextRequest) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  try {
    const { name, price, sort_order } = await req.json()
    if (!name?.trim()) return NextResponse.json({ data: null, error: 'name is required' }, { status: 400 })

    const sql = getDb()
    const [row] = await sql`
      INSERT INTO addons (cafe_id, name, price, sort_order)
      VALUES (${DEMO_CAFE_ID}, ${name.trim()}, ${Number(price) || 0}, ${Number(sort_order) || 0})
      RETURNING *
    `
    return NextResponse.json({ data: row, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to create add-on' }, { status: 500 })
  }
}
