import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory } from '@/lib/types'

type CategoryPatch = Partial<Pick<MenuCategory, 'name' | 'name_hi' | 'description' | 'sort_order' | 'is_active'>>

async function recordStaffAction(userId: string, action: string, description: string) {
  const supabase = createAdminClient()
  await supabase.from('staff_notifications').insert({
    cafe_id: DEMO_CAFE_ID,
    action,
    description,
    created_by: userId,
  })
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

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

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

  const supabase = createAdminClient()
  const { data: existing } = await supabase.from('menu_categories').select('name').eq('id', params.id).maybeSingle()

  const { count } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', params.id)

  if (count && count > 0) {
    return NextResponse.json(
      { data: null, error: `This category still has ${count} item(s) — delete or move them first` },
      { status: 409 }
    )
  }

  const { error } = await supabase.from('menu_categories').delete().eq('id', params.id)
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })

  const user = await getSessionUser(req)
  if (user?.role === 'staff') {
    const who = user.displayName || user.userId
    const catName = (existing as { name?: string } | null)?.name ?? params.id
    await recordStaffAction(user.userId, 'category_deleted', `${who} deleted menu category: "${catName}"`)
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
