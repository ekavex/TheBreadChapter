import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/types'

// GET /api/admin/users — List all users (admin only)
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auth_credentials')
    .select('id, user_id, role, display_name, updated_at')
    .order('role')

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}

// POST /api/admin/users — Create new user (admin only)
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  const { userId, password, role, displayName } = await req.json()
  if (!userId || !password || !role) {
    return NextResponse.json({ data: null, error: 'userId, password, and role are required' }, { status: 400 })
  }
  if (!['admin', 'manager', 'staff'].includes(role)) {
    return NextResponse.json({ data: null, error: 'role must be admin, manager, or staff' }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(password, 10)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auth_credentials')
    .insert({ user_id: userId, password_hash, role: role as UserRole, display_name: displayName ?? '' })
    .select('id, user_id, role, display_name, updated_at')
    .single()

  if (error) {
    const status = error.code === '23505' ? 409 : 500
    const message = error.code === '23505' ? `User "${userId}" already exists` : error.message
    return NextResponse.json({ data: null, error: message }, { status })
  }
  return NextResponse.json({ data, error: null })
}
