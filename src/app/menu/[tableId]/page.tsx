import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { MenuPageData, Cafe, MenuCategory } from '@/lib/types'
import MenuShell from '@/components/menu/MenuShell'

interface Props {
  params: { tableId: string }
  searchParams: { cafe?: string }
}

export async function generateMetadata({ searchParams }: Props) {
  const supabase = createServerSupabaseClient()
  const cafeSlug = searchParams.cafe ?? 'the-bread-chapter'
  const { data: cafe } = await supabase
    .from('cafes').select('name').eq('slug', cafeSlug).single()
  return { title: cafe?.name ?? 'Menu' }
}

export default async function MenuPage({ params, searchParams }: Props) {
  const supabase = createServerSupabaseClient()
  const cafeSlug = searchParams.cafe ?? 'the-bread-chapter'
  const tableNumber = parseInt(params.tableId, 10)

  // Fetch cafe
  const { data: cafe } = await supabase
    .from('cafes')
    .select('*')
    .eq('slug', cafeSlug)
    .eq('is_active', true)
    .single()
  if (!cafe) notFound()

  // Fetch table
  const { data: table } = await supabase
    .from('tables')
    .select('*')
    .eq('cafe_id', cafe.id)
    .eq('number', tableNumber)
    .eq('is_active', true)
    .single()
  if (!table) notFound()

  // Fetch full menu with categories
  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*, items:menu_items(*)')
    .eq('cafe_id', cafe.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  // `settings` (JSONB) and menu item `spice_level`/`upsell_item_ids` are
  // narrower in our app types than what postgrest's generated Row can prove —
  // the DB's default values + CHECK constraint guarantee the narrower shape.
  const pageData: MenuPageData = {
    cafe: cafe as Cafe,
    table,
    categories: (categories ?? []) as MenuCategory[],
  }

  return <MenuShell data={pageData} />
}
