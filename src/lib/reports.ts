// Module 11 — reports. One function per SRS report type (daily/weekly/monthly),
// each returning the sections the SRS lists (revenue/profit, stock consumption,
// top item, area performance, ingredient usage, customer analytics, best/worst day).
// Reuses M7 analytics helpers + adds report-specific slices.
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'
import { getPnLData, getAreaAnalytics, getCustomerAnalytics } from './analytics'
import type { createAdminClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createAdminClient>
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

async function getWindowOrders(
  supabase: Supabase,
  fromISO: string,
  toISO: string
): Promise<
  {
    id: string
    total_amount: number
    created_at: string
    items?: { name: string; quantity: number; subtotal: number }[] | null
    table?: { section?: { name?: string } | null } | null
  }[]
> {
  const { data } = await supabase
    .from('orders')
    .select(
      'id, total_amount, created_at, items:order_items(name, quantity, subtotal), table:tables(section:sections(name))'
    )
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('payment_status', 'paid')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: true })
  return (data ?? []) as never
}

export async function getReportData(supabase: Supabase, range: ReportRange): Promise<ReportData> {
  const days = REPORT_RANGE_DAYS[range]
  const today = new Date()
  const from = startOfDay(subDays(today, days - 1))
  const to = endOfDay(today)
  const fromISO = from.toISOString()
  const toISO = to.toISOString()

  const orders = await getWindowOrders(supabase, fromISO, toISO)

  // Revenue + cost per calendar day (for best/worst day)
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

  // Top items
  const itemAgg: Record<string, { name: string; quantity: number; revenue: number }> = {}
  orders.forEach((o) =>
    (o.items ?? []).forEach((it) => {
      if (!itemAgg[it.name]) itemAgg[it.name] = { name: it.name, quantity: 0, revenue: 0 }
      itemAgg[it.name].quantity += it.quantity
      itemAgg[it.name].revenue += it.subtotal
    })
  )
  const topSellingItems = Object.values(itemAgg).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

  // Area performance
  const areaAgg: Record<string, { orders: number; revenue: number; items: Record<string, number> }> = {}
  orders.forEach((o) => {
    const area = o.table?.section?.name ?? 'Unseated'
    if (!areaAgg[area]) areaAgg[area] = { orders: 0, revenue: 0, items: {} }
    areaAgg[area].orders += 1
    areaAgg[area].revenue += o.total_amount
    ;(o.items ?? []).forEach((it) => {
      areaAgg[area].items[it.name] = (areaAgg[area].items[it.name] ?? 0) + it.quantity
    })
  })
  const areaPerformance = Object.entries(areaAgg).map(([area, a]) => {
    const topItem = Object.entries(a.items).sort((x, y) => y[1] - x[1])[0]
    return { area, orders: a.orders, revenue: a.revenue, topItem: topItem ? topItem[0] : null }
  })

  // Ingredient usage (sale_deduction txns in window)
  const { data: usageRows } = await supabase
    .from('stock_transactions')
    .select('quantity, ingredient:ingredients(name, unit)')
    .eq('type', 'sale_deduction')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
  const usageAgg: Record<string, { name: string; unit: string; quantity: number }> = {}
  ;(usageRows ?? []).forEach((r: { quantity: number; ingredient?: { name: string; unit: string } | null }) => {
    const ing = r.ingredient
    if (!ing) return
    if (!usageAgg[ing.name]) usageAgg[ing.name] = { name: ing.name, unit: ing.unit, quantity: 0 }
    usageAgg[ing.name].quantity += Math.abs(r.quantity)
  })
  const ingredientUsage = Object.values(usageAgg).sort((a, b) => b.quantity - a.quantity)

  // Cross-module reuse
  const pnl = await getPnLData(supabase, range === 'monthly' ? 'monthly' : range === 'weekly' ? 'weekly' : 'daily')
  const customer = await getCustomerAnalytics(supabase, days)

  const revenue = pnl.totals.revenue
  const ingredientCost = pnl.totals.ingredientCost
  const orderCount = orders.length

  return {
    range,
    window: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      revenue,
      ingredientCost,
      profit: pnl.totals.profit,
      marginPct: pnl.totals.marginPct,
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
