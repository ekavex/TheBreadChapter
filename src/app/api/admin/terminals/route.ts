import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/admin/terminals - list all terminals
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const sql = getDb()
  const rows = await sql`SELECT id, client_id, label, section_id, created_at FROM terminals ORDER BY created_at ASC`
  return NextResponse.json({ data: rows, error: null })
}

// POST /api/admin/terminals - add a new terminal
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const { clientId, label } = await req.json()

  if (!clientId || !label) {
    return NextResponse.json({ data: null, error: 'clientId and label are required' }, { status: 400 })
  }
  if (!Number.isFinite(Number(clientId)) || Number(clientId) <= 0) {
    return NextResponse.json({ data: null, error: 'clientId must be a positive number (given by Pine Labs)' }, { status: 400 })
  }

  try {
    const sql = getDb()
    const [row] = await sql`
      INSERT INTO terminals (client_id, label)
      VALUES (${String(clientId)}, ${label})
      RETURNING id, client_id, label, section_id, created_at
    `
    return NextResponse.json({ data: row, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add terminal'
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ data: null, error: 'A terminal with that Client ID already exists' }, { status: 409 })
    }
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
