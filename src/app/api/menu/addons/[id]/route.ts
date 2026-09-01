import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'

// PATCH /api/menu/addons/[id] - update an add-on (name, price, is_active, sort_order)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  try {
    const body = await req.json()
    const sql = getDb()

    const [existing] = await sql`SELECT * FROM addons WHERE id = ${params.id}`
    if (!existing) return NextResponse.json({ data: null, error: 'Add-on not found' }, { status: 404 })

    const name       = body.name?.trim()       ?? existing.name
    const price      = body.price !== undefined  ? Number(body.price)      : existing.price
    const is_active  = body.is_active !== undefined ? Boolean(body.is_active) : existing.is_active
    const sort_order = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order

    const [updated] = await sql`
      UPDATE addons SET name = ${name}, price = ${price}, is_active = ${is_active}, sort_order = ${sort_order}
      WHERE id = ${params.id}
      RETURNING *
    `
    return NextResponse.json({ data: updated, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}

// DELETE /api/menu/addons/[id] - permanently delete an add-on
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  try {
    const sql = getDb()
    await sql`DELETE FROM addons WHERE id = ${params.id}`
    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Delete failed' }, { status: 500 })
  }
}
