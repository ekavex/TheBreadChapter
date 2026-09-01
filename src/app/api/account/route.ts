import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/requireDashboardSession'
import bcrypt from 'bcryptjs'

// GET /api/account - my own user_id/role/display_name, for prefilling the
// "My account" form (the session cookie only carries a stale copy of these).
export async function GET(req: NextRequest) {
  const caller = await getSessionUser(req)
  if (!caller) return NextResponse.json({ data: null, error: 'Authentication required' }, { status: 401 })

  try {
    const sql = getDb()
    const [data] = await sql`
      SELECT id, user_id, role, display_name, updated_at FROM auth_credentials WHERE user_id = ${caller.userId}
    `
    return NextResponse.json({ data: data ?? null, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load account'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// PATCH /api/account - self-service: change my own display name / password.
// Unlike /api/admin/users/[id], this never touches role and needs no
// admin/manager privilege over the target - the target is always the caller.
export async function PATCH(req: NextRequest) {
  const caller = await getSessionUser(req)
  if (!caller) return NextResponse.json({ data: null, error: 'Authentication required' }, { status: 401 })

  const { displayName, password } = await req.json()

  type UpdateShape = { display_name?: string; password_hash?: string }
  const update: UpdateShape = {}
  if (displayName !== undefined) update.display_name = displayName
  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ data: null, error: 'Password must be at least 6 characters' }, { status: 400 })
    }
    update.password_hash = await bcrypt.hash(password, 10)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ data: null, error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const sql = getDb()
    const [data] = await sql`
      UPDATE auth_credentials SET ${sql(update as Record<string, unknown>)} WHERE user_id = ${caller.userId}
      RETURNING id, user_id, role, display_name, updated_at
    `
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update account'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
