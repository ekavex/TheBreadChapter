import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

async function recordStaffAction(userId: string, action: string, description: string) {
  const supabase = createAdminClient()
  await supabase.from('staff_notifications').insert({
    cafe_id: DEMO_CAFE_ID,
    action,
    description,
    created_by: userId,
  })
}

// POST /api/menu/items — Add menu item (any authenticated role; staff action is logged)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const {
      category_id, name, name_hi, description, price, category,
      is_veg, is_vegan, is_jain, contains_gluten, contains_nuts,
      spice_level, prep_time_mins,
    } = body

    if (!category_id || !name || price === undefined || price === null) {
      return NextResponse.json({ data: null, error: 'category_id, name and price are required' }, { status: 400 })
    }
    if (!['food', 'beverage'].includes(category)) {
      return NextResponse.json({ data: null, error: 'category must be "food" or "beverage"' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        cafe_id: DEMO_CAFE_ID,
        category_id,
        name,
        name_hi: name_hi || null,
        description: description || null,
        price: Number(price),
        category,
        is_veg: is_veg ?? true,
        is_vegan: is_vegan ?? false,
        is_jain: is_jain ?? false,
        contains_gluten: contains_gluten ?? true,
        contains_nuts: contains_nuts ?? false,
        spice_level: spice_level ?? 0,
        prep_time_mins: prep_time_mins ?? 10,
      })
      .select()
      .single()

    if (error) throw error

    const user = await getSessionUser(req)
    if (user?.role === 'staff') {
      await recordStaffAction(user.userId, 'item_added', `Staff added menu item "${name}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create menu item'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
