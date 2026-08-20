import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/terminals/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const sql = getDb()
  const result = await sql`DELETE FROM terminals WHERE id = ${params.id} RETURNING id`
  if (result.length === 0) {
    return NextResponse.json({ data: null, error: 'Terminal not found' }, { status: 404 })
  }
  return NextResponse.json({ data: { ok: true }, error: null })
}
