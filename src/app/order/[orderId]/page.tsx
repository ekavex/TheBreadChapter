import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Order } from '@/lib/types'
import OrderTracker from './OrderTracker'

interface Props { params: { orderId: string } }

export const metadata = { title: 'Your Order' }

export default async function OrderPage({ params }: Props) {
  const supabase = createServerSupabaseClient()

  const { data } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', params.orderId)
    .single()

  if (!data) notFound()

  return <OrderTracker initialOrder={data as Order} />
}
