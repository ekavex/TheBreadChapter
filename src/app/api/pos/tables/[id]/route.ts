import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// PATCH /api/pos/tables/[id] — update table number/label/capacity/section
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  let bodyNumber: number | undefined
  try {
    const body = await req.json()
    bodyNumber = body.number
    const patch: {
      number?: number
      label?: string | null
      capacity?: number
      section_id?: number
      shape?: string
    } = {}
    if ('number' in body) patch.number = body.number
    if ('label' in body) patch.label = body.label === '' ? null : body.label
    if ('capacity' in body) patch.capacity = body.capacity
    if ('section_id' in body) patch.section_id = body.section_id
    if ('shape' in body) patch.shape = body.shape
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ data: null, error: 'No valid fields to update' }, { status: 400 })
    }

    const sql = getDb()
    const [data] = await sql`UPDATE tables SET ${sql(patch as Record<string, unknown>)} WHERE id = ${params.id} RETURNING *`

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ data: null, error: `Table number ${bodyNumber} already exists` }, { status: 409 })
    }
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}

// DELETE /api/pos/tables/[id] — soft-delete (is_active=false).
// Blocked if the table currently has a non-terminal order (occupied/kot_sent/billed).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()

    // Check the table's current status
    const [table] = await sql`SELECT status, number FROM tables WHERE id = ${params.id}`

    if (!table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 })
    }
    if (table.status !== 'free') {
      return NextResponse.json(
        { data: null, error: `Table ${table.number} is currently ${table.status} — free it before removing` },
        { status: 409 }
      )
    }

    await sql`UPDATE tables SET is_active = false WHERE id = ${params.id}`

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete table'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
