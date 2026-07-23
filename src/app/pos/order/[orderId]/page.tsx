import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory, Order } from '@/lib/types'
import PosOrderClient from './PosOrderClient'

export const metadata = { title: 'Order' }

export default async function PosOrderPage({ params }: { params: { orderId: string } }) {
  const supabase = createServerSupabaseClient()

  const { data: order } = await supabase
    .from('orders')
    .select('*, items:order_items(*), table:tables(*, section:sections(*))')
    .eq('id', params.orderId)
    .maybeSingle()

  if (!order) notFound()

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*, items:menu_items(*)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  return (
    <PosOrderClient
      initialOrder={order as Order}
      categories={((categories ?? []) as MenuCategory[]).map((c) => ({
        ...c,
        items: (c.items ?? []).filter((i) => i.is_available),
      }))}
    />
  )
}
