import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Item availability/price changes must be visible immediately — don't let
// Next.js's default GET route-handler caching serve a stale menu.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cafeId = new URL(req.url).searchParams.get('cafeId')
  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('menu_categories')
    .select('*, items:menu_items(*)')
    .eq('cafe_id', cafeId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}

// PATCH /api/menu — toggle item availability
export async function PATCH(req: NextRequest) {
  try {
    const { itemId, is_available } = await req.json()
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available })
      .eq('id', itemId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ data: null, error: err.message }, { status: 500 })
  }
}
