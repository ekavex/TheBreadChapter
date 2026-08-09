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

// POST /api/menu/categories — Add menu category (staff action logged)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const { name, name_hi, description, sort_order } = body

    if (!name) {
      return NextResponse.json({ data: null, error: 'name is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({
        cafe_id: DEMO_CAFE_ID,
        name,
        name_hi: name_hi || null,
        description: description || null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single()

    if (error) throw error

    const user = await getSessionUser(req)
    if (user?.role === 'staff') {
      const who = user.displayName || user.userId
      await recordStaffAction(user.userId, 'category_added', `${who} added a new menu category: "${name}"`)
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create category'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
