// Module 11 — reports.
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import { getCustomerAnalytics, orderIngredientCost } from './analytics'

export type ReportRange = 'daily' | 'weekly' | 'monthly'

export const REPORT_RANGE_DAYS: Record<ReportRange, number> = { daily: 1, weekly: 7, monthly: 30 }

export interface ReportData {
  range: ReportRange
  window: { from: string; to: string }
  summary: {
    revenue: number
    ingredientCost: number
    profit: number
    marginPct: number
    orderCount: number
    avgOrderValue: number
    bestDay: { label: string; revenue: number } | null
    worstDay: { label: string; revenue: number } | null
  }
  topSellingItems: { name: string; quantity: number; revenue: number }[]
  areaPerformance: { area: string; orders: number; revenue: number; topItem: string | null }[]
  ingredientUsage: { name: string; unit: string; quantity: number }[]
  customer: Awaited<ReturnType<typeof getCustomerAnalytics>>
}

type WindowOrder = {
  id: string
  total_amount: number
  created_at: string
  section_name: string | null
  items: { name: string; quantity: number; subtotal: number; cost_price_paisa: number | null }[]
}

async function getWindowOrders(fromISO: string, toISO: string): Promise<WindowOrder[]> {
  const sql = getDb()
  const orders = await sql`
    SELECT o.id, o.total_amount, o.created_at, s.name AS section_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN sections s ON s.id = t.section_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.payment_status = 'paid'
      AND o.created_at >= ${fromISO}
      AND o.created_at <= ${toISO}
    ORDER BY o.created_at
  `
  type ORow = { id: string; total_amount: number; created_at: string; section_name: string | null }
  type IRow = { order_id: string; name: string; quantity: number; subtotal: number; cost_price_paisa: number | null }

  const ordArr = orders as unknown as ORow[]
  const orderIds = ordArr.map((o) => o.id)
  const rawItems = orderIds.length
    ? await sql`
        SELECT oi.order_id, oi.name, oi.quantity, oi.subtotal, mi.cost_price_paisa
        FROM order_items oi
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = ANY(${sql.array(orderIds)}::uuid[])
      `
    : []

  const itemsByOrder = new Map<string, IRow[]>()
  for (const item of rawItems as unknown as IRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }

  return ordArr.map((o) => ({
    ...o,
    items: itemsByOrder.get(o.id) ?? [],
  }))
}

export async function getReportData(range: ReportRange): Promise<ReportData> {
  const sql = getDb()
  const days = REPORT_RANGE_DAYS[range]
  const today = new Date()
  const from = startOfDay(subDays(today, days - 1))
  const to = endOfDay(today)
  const fromISO = from.toISOString()
  const toISO = to.toISOString()

  const orders = await getWindowOrders(fromISO, toISO)

  const byDay: Record<string, number> = {}
  orders.forEach((o) => {
    const day = o.created_at.slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + o.total_amount
  })
  const dayEntries = Object.entries(byDay)
    .map(([label, revenue]) => ({ label, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
  const bestDay = dayEntries[0] ?? null
  const worstDay = dayEntries.length > 1 ? dayEntries[dayEntries.length - 1] : null

  const itemAgg: Record<string, { name: string; quantity: number; revenue: number }> = {}
  orders.forEach((o) =>
    o.items.forEach((it) => {
      if (!itemAgg[it.name]) itemAgg[it.name] = { name: it.name, quantity: 0, revenue: 0 }
      itemAgg[it.name].quantity += it.quantity
      itemAgg[it.name].revenue += it.subtotal
    })
  )
  const topSellingItems = Object.values(itemAgg).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

  const areaAgg: Record<string, { orders: number; revenue: number; items: Record<string, number> }> = {}
  orders.forEach((o) => {
    const area = o.section_name ?? 'Unseated'
    if (!areaAgg[area]) areaAgg[area] = { orders: 0, revenue: 0, items: {} }
    areaAgg[area].orders += 1
    areaAgg[area].revenue += o.total_amount
    o.items.forEach((it) => {
      areaAgg[area].items[it.name] = (areaAgg[area].items[it.name] ?? 0) + it.quantity
    })
  })
  const areaPerformance = Object.entries(areaAgg).map(([area, a]) => {
    const topItem = Object.entries(a.items).sort((x, y) => y[1] - x[1])[0]
    return { area, orders: a.orders, revenue: a.revenue, topItem: topItem ? topItem[0] : null }
  })

  const usageRows = await sql`
    SELECT st.quantity, i.name, i.unit
    FROM stock_transactions st
    JOIN ingredients i ON i.id = st.ingredient_id
    WHERE st.type = 'sale_deduction'
      AND st.created_at >= ${fromISO}
      AND st.created_at <= ${toISO}
  `
  const usageAgg: Record<string, { name: string; unit: string; quantity: number }> = {}
  ;(usageRows as unknown as { quantity: number; name: string; unit: string }[]).forEach((r) => {
    if (!usageAgg[r.name]) usageAgg[r.name] = { name: r.name, unit: r.unit, quantity: 0 }
    usageAgg[r.name].quantity += Math.abs(r.quantity)
  })
  const ingredientUsage = Object.values(usageAgg).sort((a, b) => b.quantity - a.quantity)

  const revenue = orders.reduce((s, o) => s + o.total_amount, 0)
  const ingredientCost = orders.reduce((s, o) => s + orderIngredientCost(o), 0)
  const profit = revenue - ingredientCost
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0
  const orderCount = orders.length

  const customer = await getCustomerAnalytics(days)

  return {
    range,
    window: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      revenue,
      ingredientCost,
      profit,
      marginPct,
      orderCount,
      avgOrderValue: orderCount > 0 ? revenue / orderCount : 0,
      bestDay,
      worstDay,
    },
    topSellingItems,
    areaPerformance,
    ingredientUsage,
    customer,
  }
}
