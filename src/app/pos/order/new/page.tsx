import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory, Order, Table } from '@/lib/types'
import PosOrderClient from '../[orderId]/PosOrderClient'

export const metadata = { title: 'New Order' }

export default async function NewOrderPage({ searchParams }: { searchParams: { tableId?: string } }) {
  const tableId = searchParams.tableId
  if (!tableId) notFound()

  const supabase = createServerSupabaseClient()

  // If an open order already exists (e.g. user hit back then tapped again),
  // resume it rather than showing a duplicate new-order screen.
  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .not('pos_status', 'in', '(PAID,CANCELLED)')
    .maybeSingle()

  if (existing) redirect(`/pos/order/${existing.id}`)

  const { data: table } = await supabase
    .from('tables')
    .select('*, section:sections(*)')
    .eq('id', tableId)
    .single()

  if (!table) notFound()

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*, items:menu_items(*)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  return (
    <PosOrderClient
      initialOrder={null}
      tableId={tableId}
      initialTable={table as Table}
      categories={((categories ?? []) as MenuCategory[]).map((c) => ({
        ...c,
        items: (c.items ?? []).filter((i) => i.is_available),
      }))}
    />
  )
}
