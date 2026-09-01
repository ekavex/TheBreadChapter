import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin, getSessionUser } from '@/lib/auth/requireDashboardSession'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/types'

// PATCH /api/admin/users/[id] - Update role, display name, or password
// Admin: can update anyone. Manager: can only update staff accounts.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  const caller = await getSessionUser(req)
  if (caller?.role !== 'admin') {
    const sql = getDb()
    const [target] = await sql`SELECT role FROM auth_credentials WHERE id = ${params.id}`
    if ((target as { role?: string } | undefined)?.role !== 'staff') {
      return NextResponse.json({ data: null, error: 'Managers can only edit staff accounts' }, { status: 403 })
    }
  }

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

  try {
    const sql = getDb()
    const [data] = await sql`
      UPDATE auth_credentials SET ${sql(update as Record<string, unknown>)} WHERE id = ${params.id}
      RETURNING id, user_id, role, display_name, updated_at
    `
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update user'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/admin/users/[id] - Remove user (admin: anyone; manager: staff only)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard

  try {
    const caller = await getSessionUser(req)
    const sql = getDb()

    const [target] = await sql`SELECT role FROM auth_credentials WHERE id = ${params.id}`
    const targetRole = (target as { role?: string } | undefined)?.role

    // Managers can only delete staff accounts
    if (caller?.role !== 'admin' && targetRole !== 'staff') {
      return NextResponse.json({ data: null, error: 'Managers can only delete staff accounts' }, { status: 403 })
    }

    // Prevent deleting the last admin
    if (targetRole === 'admin') {
      const [{ count: adminCount }] = await sql`SELECT count(*) FROM auth_credentials WHERE role = 'admin'`
      if (Number(adminCount) <= 1) {
        return NextResponse.json({ data: null, error: 'Cannot delete the last admin account' }, { status: 409 })
      }
    }

    await sql`DELETE FROM auth_credentials WHERE id = ${params.id}`
    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete user'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
