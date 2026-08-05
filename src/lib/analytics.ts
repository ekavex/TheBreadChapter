// Modules 6/7/8 — P&L, area analytics, customer analytics.
// P&L = revenue − ingredient cost (no Expense line yet — open item in the plan,
// explicitly removed from SRS scope unless re-requested).
import {
  startOfDay, endOfDay, subDays,
  startOfWeek, endOfWeek, subWeeks,
  startOfMonth, endOfMonth, subMonths,
  startOfYear, endOfYear, subYears,
} from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { createAdminClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createAdminClient>

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

// Pulls every paid order in window (with item cost + table section join), then
// bins revenue/profit by period client-side. Window is kept bounded (≤1yr) so
// the in-memory rollup stays cheap; fine for single-cafe volume.
async function fetchPaidOrdersWithCost(supabase: Supabase, fromISO: string, toISO: string) {
  const { data } = await supabase
    .from('orders')
    .select(
      'id, total_amount, created_at, customer_id, table:tables(section:sections(name)), items:order_items(quantity, menu_item:menu_items(cost_price_paisa))'
    )
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('payment_status', 'paid')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: true })
  return data ?? []
}

export function orderIngredientCost(order: {
  items?: { quantity: number; menu_item?: { cost_price_paisa?: number } | null }[] | null
}): number {
  return (order.items ?? []).reduce(
    (s, i) => s + ((i.menu_item?.cost_price_paisa ?? 0) / 100) * i.quantity,
    0
  )
}

export async function getPnLData(
  supabase: Supabase,
  range: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'monthly'
): Promise<PnLData> {
  const today = new Date()

  // Build calendar-aligned buckets so labels are always unique and meaningful.
  type Bucket = { start: Date; end: Date; label: string }
  const buckets: Bucket[] = []

  if (range === 'daily') {
    // Last 7 days — "5 Aug", "4 Aug", …
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i)
      buckets.push({
        start: startOfDay(d),
        end: endOfDay(d),
        label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      })
    }
  } else if (range === 'weekly') {
    // Last 8 calendar weeks (Mon–Sun) — "17 Jun", "24 Jun", "1 Jul", …
    for (let i = 7; i >= 0; i--) {
      const ref = subWeeks(today, i)
      const ws = startOfWeek(ref, { weekStartsOn: 1 })
      const we = endOfWeek(ref, { weekStartsOn: 1 })
      buckets.push({
        start: ws,
        end: we,
        label: ws.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      })
    }
  } else if (range === 'monthly') {
    // Last 12 calendar months — "Aug '25", "Sep '25", …, "Aug '26"
    for (let i = 11; i >= 0; i--) {
      const ref = subMonths(today, i)
      buckets.push({
        start: startOfMonth(ref),
        end: endOfMonth(ref),
        label: ref.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      })
    }
  } else {
    // Last 5 calendar years — "2022", "2023", …, "2026"
    for (let i = 4; i >= 0; i--) {
      const ref = subYears(today, i)
      buckets.push({
        start: startOfYear(ref),
        end: endOfYear(ref),
        label: ref.getFullYear().toString(),
      })
    }
  }

  const fromISO = buckets[0].start.toISOString()
  const toISO = buckets[buckets.length - 1].end.toISOString()
  const orders = await fetchPaidOrdersWithCost(supabase, fromISO, toISO)

  const rows: PnLRow[] = buckets.map(({ start, end, label }) => {
    const bucketOrders = orders.filter((o: { created_at: string }) => {
      const t = new Date(o.created_at).getTime()
      return t >= start.getTime() && t <= end.getTime()
    })
    const revenue = bucketOrders.reduce((s: number, o: { total_amount: number }) => s + o.total_amount, 0)
    const ingredientCost = bucketOrders.reduce((s: number, o) => s + orderIngredientCost(o), 0)
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

// Module 7 — per-section visitors + popular items by area + peak-hour heatmap.
export interface AreaAnalytics {
  visitors: NamedValue[] // orders per section
  popularByArea: { area: string; items: { name: string; count: number }[] }[]
  peakHourByArea: { area: string; peakHour: { hour: number; count: number } | null }[]
}

export async function getAreaAnalytics(supabase: Supabase, days = 30): Promise<AreaAnalytics> {
  const today = new Date()
  const fromISO = startOfDay(subDays(today, days - 1)).toISOString()
  const toISO = endOfDay(today).toISOString()
  const { data } = await supabase
    .from('orders')
    .select('created_at, table:tables(section:sections(name)), items:order_items(name, quantity)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .neq('status', 'cancelled')
    .neq('pos_status', 'OPEN')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
  const orders = data ?? []

  const visitorsMap: Record<string, number> = {}
  const itemsByArea: Record<string, Record<string, number>> = {}
  const hourByArea: Record<string, Record<number, number>> = {}

  orders.forEach((o: {
    created_at: string
    table?: { section?: { name?: string } | null } | null
    items?: { name: string; quantity: number }[] | null
  }) => {
    const area = o.table?.section?.name ?? 'Unseated'
    visitorsMap[area] = (visitorsMap[area] ?? 0) + 1
    if (!itemsByArea[area]) itemsByArea[area] = {}
    if (!hourByArea[area]) hourByArea[area] = {}
    ;(o.items ?? []).forEach((it) => {
      itemsByArea[area][it.name] = (itemsByArea[area][it.name] ?? 0) + it.quantity
    })
    const hour = new Date(o.created_at).getHours()
    hourByArea[area][hour] = (hourByArea[area][hour] ?? 0) + 1
  })

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

// Module 8 — customer analytics. New/repeat counts need the customer_id FK on
// orders, which only exists where the waiter captured a phone (walk-ins excluded).
export interface CustomerAnalytics {
  totalCustomers: number
  newCustomers: number
  repeatCustomers: number
  mostOrderedItem: { name: string; count: number } | null
  peakVisitingHour: { hour: number; count: number } | null
  avgBillValue: number
}

export async function getCustomerAnalytics(supabase: Supabase, days = 30): Promise<CustomerAnalytics> {
  const today = new Date()
  const fromISO = startOfDay(subDays(today, days - 1)).toISOString()
  const toISO = endOfDay(today).toISOString()

  const { data: ordersRaw } = await supabase
    .from('orders')
    .select('created_at, total_amount, customer_id, items:order_items(name, quantity)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('payment_status', 'paid')
    .gte('created_at', fromISO)

  const paidOrders = (ordersRaw ?? []) as { created_at: string; total_amount: number; customer_id: string | null; items?: { name: string; quantity: number }[] | null }[]

  // Derive new/repeat from actual orders.customer_id rather than
  // customers.total_orders — that counter is bumped by a stats trigger that
  // isn't part of this project's schema, so counting orders directly is the
  // source of truth. Anonymous walk-ins (null customer_id) excluded.
  const orderCountByCustomer: Record<string, number> = {}
  paidOrders.forEach((o) => {
    if (o.customer_id) orderCountByCustomer[o.customer_id] = (orderCountByCustomer[o.customer_id] ?? 0) + 1
  })
  const customerCounts = Object.values(orderCountByCustomer)
  const totalCustomers = customerCounts.length
  const newCustomers = customerCounts.filter((c) => c === 1).length
  const repeatCustomers = customerCounts.filter((c) => c > 1).length

  const itemCounts: Record<string, number> = {}
  paidOrders.forEach((o: { items?: { name: string; quantity: number }[] | null }) =>
    (o.items ?? []).forEach((it) => {
      itemCounts[it.name] = (itemCounts[it.name] ?? 0) + it.quantity
    })
  )
  const mostOrderedEntry = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]

  const hourCounts: Record<number, number> = {}
  paidOrders.forEach((o: { created_at: string }) => {
    const hour = new Date(o.created_at).getHours()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
  })
  const peakEntry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]

  const avgBillValue = paidOrders.length > 0
    ? paidOrders.reduce((s: number, o: { total_amount: number }) => s + o.total_amount, 0) / paidOrders.length
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
