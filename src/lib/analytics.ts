// Modules 6/7/8 — P&L, area analytics, customer analytics.
import {
  startOfDay, endOfDay, subDays,
  startOfWeek, endOfWeek, subWeeks,
  startOfMonth, endOfMonth, subMonths,
  startOfYear, endOfYear, subYears,
} from 'date-fns'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'

export interface NamedValue {
  name: string
  value: number
  count?: number
}

export interface PnLRow {
  label: string
  revenue: number
  ingredientCost: number
  profit: number
  marginPct: number
  orderCount: number
}

export interface PnLData {
  range: 'daily' | 'weekly' | 'monthly' | 'yearly'
  rows: PnLRow[]
  totals: { revenue: number; ingredientCost: number; profit: number; marginPct: number; orderCount: number }
}

type FlatOrder = {
  id: string
  total_amount: number
  created_at: string
  customer_id: string | null
  section_name: string | null
}
type FlatItem = { order_id: string; quantity: number; cost_price_paisa: number | null }

async function fetchPaidOrdersWithCost(fromISO: string, toISO: string): Promise<(FlatOrder & { items: FlatItem[] })[]> {
  const sql = getDb()
  const orders = await sql`
    SELECT o.id, o.total_amount, o.created_at, o.customer_id,
           s.name AS section_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN sections s ON s.id = t.section_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.payment_status = 'paid'
      AND o.created_at >= ${fromISO}
      AND o.created_at <= ${toISO}
    ORDER BY o.created_at
  `
  const ordArr = orders as unknown as FlatOrder[]
  const orderIds = ordArr.map((o) => o.id)
  const rawItems = orderIds.length
    ? await sql`
        SELECT oi.order_id, oi.quantity, mi.cost_price_paisa
        FROM order_items oi
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = ANY(${sql.array(orderIds)}::uuid[])
      `
    : []

  const itemsByOrder = new Map<string, FlatItem[]>()
  for (const item of rawItems as unknown as FlatItem[]) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }

  return ordArr.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] }))
}

export function orderIngredientCost(order: {
  items?: { quantity: number; cost_price_paisa?: number | null }[] | null
}): number {
  return (order.items ?? []).reduce(
    (s, i) => s + ((i.cost_price_paisa ?? 0) / 100) * i.quantity,
    0
  )
}

export async function getPnLData(
  range: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'monthly'
): Promise<PnLData> {
  const today = new Date()

  type Bucket = { start: Date; end: Date; label: string }
  const buckets: Bucket[] = []

  if (range === 'daily') {
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i)
      buckets.push({
        start: startOfDay(d),
        end: endOfDay(d),
        label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      })
    }
  } else if (range === 'weekly') {
    for (let i = 7; i >= 0; i--) {
      const ref = subWeeks(today, i)
      const ws = startOfWeek(ref, { weekStartsOn: 1 })
      const we = endOfWeek(ref, { weekStartsOn: 1 })
      buckets.push({ start: ws, end: we, label: ws.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })
    }
  } else if (range === 'monthly') {
    for (let i = 11; i >= 0; i--) {
      const ref = subMonths(today, i)
      buckets.push({ start: startOfMonth(ref), end: endOfMonth(ref), label: ref.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) })
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const ref = subYears(today, i)
      buckets.push({ start: startOfYear(ref), end: endOfYear(ref), label: ref.getFullYear().toString() })
    }
  }

  const fromISO = buckets[0].start.toISOString()
  const toISO = buckets[buckets.length - 1].end.toISOString()
  const orders = await fetchPaidOrdersWithCost(fromISO, toISO)

  const rows: PnLRow[] = buckets.map(({ start, end, label }) => {
    const bucketOrders = orders.filter((o) => {
      const t = new Date(o.created_at).getTime()
      return t >= start.getTime() && t <= end.getTime()
    })
    const revenue = bucketOrders.reduce((s, o) => s + o.total_amount, 0)
    const ingredientCost = bucketOrders.reduce((s, o) => s + orderIngredientCost(o), 0)
    return {
      label,
      revenue,
      ingredientCost,
      profit: revenue - ingredientCost,
      marginPct: revenue > 0 ? ((revenue - ingredientCost) / revenue) * 100 : 0,
      orderCount: bucketOrders.length,
    }
  })

  const revenue = rows.reduce((s, r) => s + r.revenue, 0)
  const ingredientCost = rows.reduce((s, r) => s + r.ingredientCost, 0)
  return {
    range,
    rows,
    totals: {
      revenue,
      ingredientCost,
      profit: revenue - ingredientCost,
      marginPct: revenue > 0 ? ((revenue - ingredientCost) / revenue) * 100 : 0,
      orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
    },
  }
}

export interface AreaAnalytics {
  visitors: NamedValue[]
  popularByArea: { area: string; items: { name: string; count: number }[] }[]
  peakHourByArea: { area: string; peakHour: { hour: number; count: number } | null }[]
}

export async function getAreaAnalytics(days = 30): Promise<AreaAnalytics> {
  const sql = getDb()
  const today = new Date()
  const fromISO = startOfDay(subDays(today, days - 1)).toISOString()
  const toISO = endOfDay(today).toISOString()

  const orders = await sql`
    SELECT o.id, o.created_at, s.name AS section_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN sections s ON s.id = t.section_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.status != 'cancelled'
      AND o.pos_status != 'OPEN'
      AND o.created_at >= ${fromISO}
      AND o.created_at <= ${toISO}
  `
  type ORow = { id: string; created_at: string; section_name: string | null }
  type IRow = { order_id: string; name: string; quantity: number }

  const ordArr = orders as unknown as ORow[]
  const orderIds = ordArr.map((o) => o.id)
  const rawItems = orderIds.length
    ? await sql`
        SELECT order_id, name, quantity
        FROM order_items
        WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])
      `
    : []

  const itemsByOrder = new Map<string, IRow[]>()
  for (const item of rawItems as unknown as IRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }

  const visitorsMap: Record<string, number> = {}
  const itemsByArea: Record<string, Record<string, number>> = {}
  const hourByArea: Record<string, Record<number, number>> = {}

  for (const o of ordArr) {
    const area = o.section_name ?? 'Unseated'
    visitorsMap[area] = (visitorsMap[area] ?? 0) + 1
    if (!itemsByArea[area]) itemsByArea[area] = {}
    if (!hourByArea[area]) hourByArea[area] = {}
    for (const it of itemsByOrder.get(o.id) ?? []) {
      itemsByArea[area][it.name] = (itemsByArea[area][it.name] ?? 0) + it.quantity
    }
    const hour = new Date(o.created_at).getHours()
    hourByArea[area][hour] = (hourByArea[area][hour] ?? 0) + 1
  }

  const visitors = Object.entries(visitorsMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const popularByArea = Object.entries(itemsByArea).map(([area, items]) => ({
    area,
    items: Object.entries(items)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  }))

  const peakHourByArea = Object.entries(hourByArea).map(([area, hours]) => {
    const top = Object.entries(hours).sort((a, b) => b[1] - a[1])[0]
    return { area, peakHour: top ? { hour: Number(top[0]), count: top[1] } : null }
  })

  return { visitors, popularByArea, peakHourByArea }
}

export interface CustomerAnalytics {
  totalCustomers: number
  newCustomers: number
  repeatCustomers: number
  mostOrderedItem: { name: string; count: number } | null
  peakVisitingHour: { hour: number; count: number } | null
  avgBillValue: number
}

export async function getCustomerAnalytics(days = 30): Promise<CustomerAnalytics> {
  const sql = getDb()
  const today = new Date()
  const fromISO = startOfDay(subDays(today, days - 1)).toISOString()

  const orders = await sql`
    SELECT o.id, o.created_at, o.total_amount, o.customer_id
    FROM orders o
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.payment_status = 'paid'
      AND o.created_at >= ${fromISO}
  `
  type ORow = { id: string; created_at: string; total_amount: number; customer_id: string | null }
  type IRow = { order_id: string; name: string; quantity: number }

  const paidOrders = orders as unknown as ORow[]
  const orderIds = paidOrders.map((o) => o.id)
  const rawItems = orderIds.length
    ? await sql`SELECT order_id, name, quantity FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])`
    : []

  const itemsByOrder = new Map<string, IRow[]>()
  for (const item of rawItems as unknown as IRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }
  const orderCountByCustomer: Record<string, number> = {}
  paidOrders.forEach((o) => {
    if (o.customer_id) orderCountByCustomer[o.customer_id] = (orderCountByCustomer[o.customer_id] ?? 0) + 1
  })
  const customerCounts = Object.values(orderCountByCustomer)
  const totalCustomers = customerCounts.length
  const newCustomers = customerCounts.filter((c) => c === 1).length
  const repeatCustomers = customerCounts.filter((c) => c > 1).length

  const itemCounts: Record<string, number> = {}
  paidOrders.forEach((o) =>
    (itemsByOrder.get(o.id) ?? []).forEach((it) => {
      itemCounts[it.name] = (itemCounts[it.name] ?? 0) + it.quantity
    })
  )
  const mostOrderedEntry = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]

  const hourCounts: Record<number, number> = {}
  paidOrders.forEach((o) => {
    const hour = new Date(o.created_at).getHours()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
  })
  const peakEntry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]

  const avgBillValue = paidOrders.length > 0
    ? paidOrders.reduce((s, o) => s + o.total_amount, 0) / paidOrders.length
    : 0

  return {
    totalCustomers,
    newCustomers,
    repeatCustomers,
    mostOrderedItem: mostOrderedEntry ? { name: mostOrderedEntry[0], count: mostOrderedEntry[1] } : null,
    peakVisitingHour: peakEntry ? { hour: Number(peakEntry[0]), count: peakEntry[1] } : null,
    avgBillValue,
  }
}
