import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory } from '@/lib/types'

type CategoryPatch = Partial<Pick<MenuCategory, 'name' | 'name_hi' | 'description' | 'sort_order' | 'is_active'>>

async function recordStaffAction(userId: string, action: string, description: string) {
  const sql = getDb()
  await sql`INSERT INTO staff_notifications (cafe_id, action, description, created_by) VALUES (${DEMO_CAFE_ID}, ${action}, ${description}, ${userId})`
}

// PATCH /api/menu/categories/[id] — Edit menu category (staff action logged)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const updateData: CategoryPatch = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.name_hi !== undefined) updateData.name_hi = body.name_hi || null
    if (body.description !== undefined) updateData.description = body.description || null
    if (body.sort_order !== undefined) updateData.sort_order = Number(body.sort_order)
    if (body.is_active !== undefined) updateData.is_active = Boolean(body.is_active)

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ data: null, error: 'No valid fields to update' }, { status: 400 })
    }

    const sql = getDb()
    const [data] = await sql`UPDATE menu_categories SET ${sql(updateData as Record<string, unknown>)} WHERE id = ${params.id} RETURNING *`

    const user = await getSessionUser(req)
    if (user?.role === 'staff') {
      const who = user.displayName || user.userId
      const catName = (data as { name?: string })?.name ?? params.id
      await recordStaffAction(user.userId, 'category_updated', `${who} updated menu category: "${catName}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update category'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/menu/categories/[id] — Delete menu category (staff action logged)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [existing] = await sql`SELECT name FROM menu_categories WHERE id = ${params.id}`

    const [{ count }] = await sql`SELECT count(*) FROM menu_items WHERE category_id = ${params.id}`

    if (Number(count) > 0) {
      return NextResponse.json(
        { data: null, error: `This category still has ${count} item(s) — delete or move them first` },
        { status: 409 }
      )
    }

    await sql`DELETE FROM menu_categories WHERE id = ${params.id}`

    const user = await getSessionUser(req)
    if (user?.role === 'staff') {
      const who = user.displayName || user.userId
      const catName = (existing as { name?: string } | undefined)?.name ?? params.id
      await recordStaffAction(user.userId, 'category_deleted', `${who} deleted menu category: "${catName}"`)
    }

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete category'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
