import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuItem } from '@/lib/types'

type ItemPatch = Partial<
  Pick<
    MenuItem,
    | 'category_id' | 'name' | 'name_hi' | 'description' | 'price' | 'category'
    | 'is_veg' | 'is_vegan' | 'is_jain' | 'contains_gluten' | 'contains_nuts'
    | 'spice_level' | 'prep_time_mins' | 'is_available' | 'is_featured'
  >
>

async function recordStaffAction(userId: string, action: string, description: string) {
  const supabase = createAdminClient()
  await supabase.from('staff_notifications').insert({
    cafe_id: DEMO_CAFE_ID,
    action,
    description,
    created_by: userId,
  })
}

// PATCH /api/menu/items/[id] — Edit menu item (staff action logged)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const updateData: ItemPatch = {}
    const stringFields = ['category_id', 'name', 'category'] as const
    const optionalStringFields = ['name_hi', 'description'] as const
    const boolFields = ['is_veg', 'is_vegan', 'is_jain', 'contains_gluten', 'contains_nuts', 'is_available', 'is_featured'] as const
    const numberFields = ['price', 'spice_level', 'prep_time_mins'] as const

    for (const key of stringFields) if (body[key] !== undefined) (updateData as Record<string, unknown>)[key] = body[key]
    for (const key of optionalStringFields) if (body[key] !== undefined) (updateData as Record<string, unknown>)[key] = body[key] || null
    for (const key of boolFields) if (body[key] !== undefined) (updateData as Record<string, unknown>)[key] = Boolean(body[key])
    for (const key of numberFields) if (body[key] !== undefined) (updateData as Record<string, unknown>)[key] = Number(body[key])

    if (updateData.category && !['food', 'beverage'].includes(updateData.category)) {
      return NextResponse.json({ data: null, error: 'category must be "food" or "beverage"' }, { status: 400 })
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ data: null, error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('menu_items')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    const user = await getSessionUser(req)
    if (user?.role === 'staff') {
      const itemName = (data as { name?: string })?.name ?? params.id
      await recordStaffAction(user.userId, 'item_updated', `Staff updated menu item "${itemName}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/menu/items/[id] — Delete menu item (staff action logged)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  // Fetch the name before deleting for the notification
  const supabase = createAdminClient()
  const { data: existing } = await supabase.from('menu_items').select('name').eq('id', params.id).maybeSingle()

  const { error } = await supabase.from('menu_items').delete().eq('id', params.id)

  if (error) {
    const status = error.code === '23503' ? 409 : 500
    const message =
      error.code === '23503'
        ? 'This item has previous orders on record — mark it unavailable instead of deleting it'
        : error.message
    return NextResponse.json({ data: null, error: message }, { status })
  }

  const user = await getSessionUser(req)
  if (user?.role === 'staff') {
    const itemName = (existing as { name?: string } | null)?.name ?? params.id
    await recordStaffAction(user.userId, 'item_deleted', `Staff deleted menu item "${itemName}"`)
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
