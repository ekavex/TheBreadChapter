import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMenuCrudToken } from '@/lib/auth/requireMenuCrud'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import type { MenuItem } from '@/lib/types'

type ItemPatch = Partial<
  Pick<
    MenuItem,
    | 'category_id' | 'name' | 'name_hi' | 'description' | 'price' | 'category'
    | 'is_veg' | 'is_vegan' | 'is_jain' | 'contains_gluten' | 'contains_nuts'
    | 'spice_level' | 'prep_time_mins' | 'is_available' | 'is_featured'
  >
>

// PATCH /api/menu/items/[id] — Module 9: menu-CRUD gated (Edit Menu item).
// Separate from PATCH /api/menu, which only toggles availability and is
// intentionally left ungated (an operational sold-out toggle, not "editing
// the menu" in the SRS's structural sense).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const guard = await requireMenuCrudToken(req)
  if (guard) return guard

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
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/menu/items/[id] — Module 9: menu-CRUD gated (Delete Menu item).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const guard = await requireMenuCrudToken(req)
  if (guard) return guard

  const supabase = createAdminClient()
  const { error } = await supabase.from('menu_items').delete().eq('id', params.id)

  if (error) {
    // FK violation — item has been ordered before (order_items references it)
    const status = error.code === '23503' ? 409 : 500
    const message =
      error.code === '23503'
        ? 'This item has previous orders on record — mark it unavailable instead of deleting it'
        : error.message
    return NextResponse.json({ data: null, error: message }, { status })
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
