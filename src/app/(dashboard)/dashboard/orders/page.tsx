import { getDb } from '@/lib/db'
import { startOfDay, endOfDay, subDays, format } from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Order } from '@/lib/types'
import OrdersClient from './OrdersClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orders' }

interface Props {
  searchParams: { date?: string; status?: string }
}

export default async function OrdersPage({ searchParams }: Props) {
  const sql = getDb()
  const dateStr = searchParams.date ?? format(new Date(), 'yyyy-MM-dd')
  const day = new Date(dateStr)
  const startISO = startOfDay(day).toISOString()
  const endISO = endOfDay(day).toISOString()

  const ordersRaw = await sql`
    SELECT o.* FROM orders o
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.created_at >= ${startISO}
      AND o.created_at <= ${endISO}
      AND o.pos_status != 'OPEN'
    ORDER BY o.created_at DESC
  `

  let orders: Order[] = []
  if (ordersRaw.length > 0) {
    const rawArr = ordersRaw as unknown as { id: string; table_id?: string }[]
    const orderIds = rawArr.map((o) => o.id)
    const tableIds = rawArr.map((o) => o.table_id).filter(Boolean) as string[]

    const [allItems, tableRows] = await Promise.all([
      sql`SELECT * FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])`,
      tableIds.length ? sql`SELECT id, number, label FROM tables WHERE id = ANY(${sql.array(tableIds)}::uuid[])` : Promise.resolve([]),
    ])
    const itemArr = allItems as unknown as { order_id: string }[]
    const tableMap = Object.fromEntries((tableRows as unknown as { id: string }[]).map((t) => [t.id, t]))

    orders = rawArr.map((o) => ({
      ...o,
      items: itemArr.filter((i) => i.order_id === o.id),
      table: o.table_id ? tableMap[o.table_id] ?? null : null,
    })) as Order[]
  }

  const dates = Array.from({ length: 7 }, (_, i) =>
    format(subDays(new Date(), i), 'yyyy-MM-dd')
  )

  return (
    <OrdersClient
      orders={orders}
      currentDate={dateStr}
      availableDates={dates}
      activeStatus={searchParams.status ?? 'all'}
    />
  )
}
