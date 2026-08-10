import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// POST /api/pos/tables — create a new table (manager only)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  let number: number | undefined
  try {
    const body = await req.json()
    number = body.number
    const { label, capacity, section_id, shape } = body

    if (!number || typeof number !== 'number') {
      return NextResponse.json({ data: null, error: 'Table number is required' }, { status: 400 })
    }
    if (!section_id) {
      return NextResponse.json({ data: null, error: 'Section is required' }, { status: 400 })
    }

    const sql = getDb()
    const [data] = await sql`
      INSERT INTO tables (cafe_id, number, label, capacity, shape, section_id, is_active, status)
      VALUES (
        ${DEMO_CAFE_ID},
        ${number},
        ${label?.trim() || null},
        ${capacity ?? 4},
        ${shape ?? 'square'},
        ${section_id},
        true,
        'free'
      )
      RETURNING *
    `

    return NextResponse.json({ data, error: null }, { status: 201 })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ data: null, error: `Table ${number} already exists` }, { status: 409 })
    }
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to create table' }, { status: 500 })
  }
}

// GET /api/pos/tables — sections + tables with live status (Module 5:
// "Each table shows a live status — Free, Occupied, KOT Sent, or Billed").
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [sections, tables] = await Promise.all([
      sql`SELECT * FROM sections ORDER BY sort_order ASC`,
      sql`SELECT * FROM tables WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY number ASC`,
    ])

    const bySection = sections.map((section) => ({
      section,
      tables: tables.filter((t) => t.section_id === section.id),
    }))

    return NextResponse.json({ data: bySection, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch tables'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
