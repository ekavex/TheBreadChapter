import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// PATCH /api/pos/tables/[id] — update table number/label/capacity/section
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
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

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tables')
      .update(patch)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ data: null, error: `Table number ${body.number} already exists` }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ data, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}

// DELETE /api/pos/tables/[id] — soft-delete (is_active=false).
// Blocked if the table currently has a non-terminal order (occupied/kot_sent/billed).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const supabase = createAdminClient()

  // Check the table's current status
  const { data: table, error: fetchError } = await supabase
    .from('tables')
    .select('status, number')
    .eq('id', params.id)
    .single()

  if (fetchError || !table) {
    return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 })
  }
  if (table.status !== 'free') {
    return NextResponse.json(
      { data: null, error: `Table ${table.number} is currently ${table.status} — free it before removing` },
      { status: 409 }
    )
  }

  const { error } = await supabase
    .from('tables')
    .update({ is_active: false })
    .eq('id', params.id)

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data: { ok: true }, error: null })
}
