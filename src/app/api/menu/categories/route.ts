import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMenuCrudToken } from '@/lib/auth/requireMenuCrud'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

// POST /api/menu/categories — Module 9: menu-CRUD gated (Add Menu Category)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const guard = await requireMenuCrudToken(req)
  if (guard) return guard

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
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create category'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
