import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Item availability/price changes must be visible immediately — don't let
// Next.js's default GET route-handler caching serve a stale menu.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cafeId = new URL(req.url).searchParams.get('cafeId')
  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  try {
    const sql = getDb()
    const categories = await sql`
      SELECT * FROM menu_categories
      WHERE cafe_id = ${cafeId} AND is_active = true
      ORDER BY sort_order ASC
    `
    const catIds = categories.map((c) => c.id)
    const items = catIds.length
      ? await sql`SELECT * FROM menu_items WHERE category_id = ANY(${sql.array(catIds)}::uuid[]) ORDER BY sort_order ASC`
      : []
    const data = categories.map((cat) => ({ ...cat, items: items.filter((i) => i.category_id === cat.id) }))

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch menu'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH /api/menu — toggle item availability
export async function PATCH(req: NextRequest) {
  try {
    const { itemId, is_available } = await req.json()
    const sql = getDb()

    const [data] = await sql`
      UPDATE menu_items SET is_available = ${is_available} WHERE id = ${itemId} RETURNING *
    `

    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ data: null, error: err.message }, { status: 500 })
  }
}
