import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/types'

// PATCH /api/admin/users/[id] — Update role, display name, or password (admin only)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const { role, displayName, password } = await req.json()

  if (role !== undefined && !['admin', 'manager', 'staff'].includes(role)) {
    return NextResponse.json({ data: null, error: 'Invalid role' }, { status: 400 })
  }

  type UpdateShape = {
    role?: string
    display_name?: string
    password_hash?: string
  }
  const update: UpdateShape = {}
  if (role !== undefined) update.role = role as UserRole
  if (displayName !== undefined) update.display_name = displayName
  if (password) update.password_hash = await bcrypt.hash(password, 10)

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ data: null, error: 'Nothing to update' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auth_credentials')
    .update(update)
    .eq('id', params.id)
    .select('id, user_id, role, display_name, updated_at')
    .single()

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}

// DELETE /api/admin/users/[id] — Remove user (admin only)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const supabase = createAdminClient()

  // Prevent deleting the last admin
  const { count } = await supabase
    .from('auth_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')

  const { data: target } = await supabase.from('auth_credentials').select('role').eq('id', params.id).maybeSingle()
  if ((target as { role?: string } | null)?.role === 'admin' && (count ?? 0) <= 1) {
    return NextResponse.json({ data: null, error: 'Cannot delete the last admin account' }, { status: 409 })
  }

  const { error } = await supabase.from('auth_credentials').delete().eq('id', params.id)
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data: { ok: true }, error: null })
}
