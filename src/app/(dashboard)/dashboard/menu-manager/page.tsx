import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { MenuCategory } from '@/lib/types'
import MenuManagerClient from './MenuManagerClient'

const DEMO_CAFE_ID = '11111111-1111-1111-1111-111111111111'

export const metadata = { title: 'Menu Manager' }

export default async function MenuManagerPage() {
  const supabase = createServerSupabaseClient()

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*, items:menu_items(*)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  return <MenuManagerClient categories={(categories ?? []) as MenuCategory[]} />
}
