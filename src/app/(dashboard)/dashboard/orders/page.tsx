import { createServerSupabaseClient } from '@/lib/supabase/server'
import { startOfDay, endOfDay, subDays, format } from 'date-fns'
import type { Order } from '@/lib/types'
import OrdersClient from './OrdersClient'

const DEMO_CAFE_ID = '11111111-1111-1111-1111-111111111111'

export const metadata = { title: 'Orders' }

interface Props {
  searchParams: { date?: string; status?: string }
}

export default async function OrdersPage({ searchParams }: Props) {
  const supabase = createServerSupabaseClient()
  const dateStr = searchParams.date ?? format(new Date(), 'yyyy-MM-dd')
  const day = new Date(dateStr)

  const { data: orders } = await supabase
    .from('orders')
    .select('*, items:order_items(*), table:tables(number,label)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .gte('created_at', startOfDay(day).toISOString())
    .lte('created_at', endOfDay(day).toISOString())
    .neq('pos_status', 'OPEN')
    .order('created_at', { ascending: false })

  // Last 7 days for date picker
  const dates = Array.from({ length: 7 }, (_, i) =>
    format(subDays(new Date(), i), 'yyyy-MM-dd')
  )

  return (
    <OrdersClient
      orders={(orders ?? []) as Order[]}
      currentDate={dateStr}
      availableDates={dates}
      activeStatus={searchParams.status ?? 'all'}
    />
  )
}
