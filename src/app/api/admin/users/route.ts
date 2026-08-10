import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/types'

// GET /api/admin/users — List all users (admin only)
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (guard) return guard

  try {
    const sql = getDb()
    const data = await sql`SELECT id, user_id, role, display_name, updated_at FROM auth_credentials ORDER BY role`
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch users'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
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

  try {
    const password_hash = await bcrypt.hash(password, 10)
    const sql = getDb()
    const [data] = await sql`
      INSERT INTO auth_credentials (user_id, password_hash, role, display_name)
      VALUES (${userId}, ${password_hash}, ${role as UserRole}, ${displayName ?? ''})
      RETURNING id, user_id, role, display_name, updated_at
    `
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const code = (err as { code?: string }).code
    const status = code === '23505' ? 409 : 500
    const message = code === '23505' ? `User "${userId}" already exists` : (err instanceof Error ? err.message : 'Failed to create user')
    return NextResponse.json({ data: null, error: message }, { status })
  }
}
