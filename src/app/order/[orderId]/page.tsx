import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import type { Order } from '@/lib/types'
import OrderTracker from './OrderTracker'

interface Props { params: { orderId: string } }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your Order' }

export default async function OrderPage({ params }: Props) {
  const sql = getDb()

  const [order] = await sql`SELECT * FROM orders WHERE id = ${params.orderId}`
  if (!order) notFound()

  const items = await sql`SELECT * FROM order_items WHERE order_id = ${params.orderId} ORDER BY created_at`
  const data: Order = { ...order, items } as unknown as Order

  return <OrderTracker initialOrder={data} />
}
