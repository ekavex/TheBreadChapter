import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuItem } from '@/lib/types'

type ItemPatch = Partial<
  Pick<
    MenuItem,
    | 'category_id' | 'name' | 'name_hi' | 'description' | 'price' | 'category'
    | 'is_veg' | 'is_vegan' | 'is_jain' | 'contains_gluten' | 'contains_nuts'
    | 'spice_level' | 'prep_time_mins' | 'is_available' | 'is_featured'
  >
> & { variants?: unknown }

async function recordStaffAction(userId: string, action: string, description: string) {
  const sql = getDb()
  await sql`INSERT INTO staff_notifications (cafe_id, action, description, created_by) VALUES (${DEMO_CAFE_ID}, ${action}, ${description}, ${userId})`
}

// PATCH /api/menu/items/[id] - Edit menu item (staff action logged)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
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
    // Handle variants separately - sql() tag can't serialize JSONB in a SET clause
    let variantsOverride: { apply: boolean; value: unknown } = { apply: false, value: null }
    if ('variants' in body) {
      variantsOverride = {
        apply: true,
        value: Array.isArray(body.variants) && body.variants.length > 0 ? body.variants : null,
      }
    }

    if (Object.keys(updateData).length === 0 && !variantsOverride.apply) {
      return NextResponse.json({ data: null, error: 'No valid fields to update' }, { status: 400 })
    }

    const sql = getDb()
    let data: unknown
    if (Object.keys(updateData).length > 0 && variantsOverride.apply) {
      ;[data] = await sql`
        UPDATE menu_items
        SET ${sql(updateData as Record<string, unknown>)}, variants = ${variantsOverride.value ? sql.json(variantsOverride.value as import('@/lib/types').MenuItemVariant[]) : null}
        WHERE id = ${params.id}
        RETURNING *
      `
    } else if (variantsOverride.apply) {
      ;[data] = await sql`
        UPDATE menu_items
        SET variants = ${variantsOverride.value ? sql.json(variantsOverride.value as import('@/lib/types').MenuItemVariant[]) : null}
        WHERE id = ${params.id}
        RETURNING *
      `
    } else {
      ;[data] = await sql`UPDATE menu_items SET ${sql(updateData as Record<string, unknown>)} WHERE id = ${params.id} RETURNING *`
    }

    const user = await getSessionUser(req)
    if (user && user.role !== 'admin') {
      const who = user.displayName || user.userId
      const itemName = (data as { name?: string })?.name ?? params.id
      await recordStaffAction(user.userId, 'item_updated', `${who} updated menu item: "${itemName}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/menu/items/[id] - Delete menu item (staff action logged)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    // Fetch the name before deleting for the notification
    const [existing] = await sql`SELECT name FROM menu_items WHERE id = ${params.id}`

    await sql`DELETE FROM menu_items WHERE id = ${params.id}`

    const user = await getSessionUser(req)
    if (user && user.role !== 'admin') {
      const who = user.displayName || user.userId
      const itemName = (existing as { name?: string } | undefined)?.name ?? params.id
      await recordStaffAction(user.userId, 'item_deleted', `${who} deleted menu item: "${itemName}"`)
    }

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23503') {
      return NextResponse.json(
        { data: null, error: 'This item has previous orders on record - mark it unavailable instead of deleting it' },
        { status: 409 }
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to delete menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
