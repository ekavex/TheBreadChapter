// Module 10 "Live Dashboard" — today's sales/profit, low-stock items, top
// seller, most-visited area, peak hour, pending orders, inventory value,
// live table statuses. Shared by the server-rendered overview page and
// GET /api/dashboard so the two never drift out of sync.
import { startOfDay, endOfDay } from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { createAdminClient } from '@/lib/supabase/server'
import type { Ingredient, Section, Table } from '@/lib/types'

type Supabase = ReturnType<typeof createAdminClient>

export interface NamedCount {
  name: string
  count: number
}

export interface DashboardData {
  todaysSales: number // rupees
  todaysProfit: number // rupees
  ordersToday: number
  avgOrderValue: number
  topSellerToday: NamedCount | null
  topItemsToday: NamedCount[]
  mostVisitedArea: NamedCount | null
  peakHour: { hour: number; count: number } | null
  pendingOrders: number
  lowStockItems: Ingredient[]
  inventoryValuePaisa: number
  sections: { section: Section; tables: Table[] }[]
}

export async function getDashboardData(supabase: Supabase): Promise<DashboardData> {
  const today = new Date()
  const startISO = startOfDay(today).toISOString()
  const endISO = endOfDay(today).toISOString()

  const { data: todaysOrdersRaw } = await supabase
    .from('orders')
    .select('*, items:order_items(*, menu_item:menu_items(cost_price_paisa)), table:tables(section:sections(name))')
    .eq('cafe_id', DEMO_CAFE_ID)
    .gte('created_at', startISO)
    .lte('created_at', endISO)
    .neq('pos_status', 'OPEN')

  const todaysOrders = todaysOrdersRaw ?? []
  const paidOrders = todaysOrders.filter((o) => o.payment_status === 'paid')

  const todaysSales = paidOrders.reduce((sum, o) => sum + o.total_amount, 0)
  const todaysCost = paidOrders.reduce((sum, o) => {
    const orderCost = (o.items ?? []).reduce(
      (s, i) => s + ((i.menu_item?.cost_price_paisa ?? 0) / 100) * i.quantity,
      0
    )
    return sum + orderCost
  }, 0)
  const todaysProfit = todaysSales - todaysCost

  const itemCounts: Record<string, number> = {}
  todaysOrders.forEach((o) => (o.items ?? []).forEach((i) => {
    itemCounts[i.name] = (itemCounts[i.name] ?? 0) + i.quantity
  }))
  const topItemsToday = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  const topSellerToday = topItemsToday[0] ?? null

  const areaCounts: Record<string, number> = {}
  todaysOrders.forEach((o) => {
    const sectionName = o.table?.section?.name
    if (sectionName) areaCounts[sectionName] = (areaCounts[sectionName] ?? 0) + 1
  })
  const mostVisitedEntry = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0]
  const mostVisitedArea = mostVisitedEntry ? { name: mostVisitedEntry[0], count: mostVisitedEntry[1] } : null

  const hourCounts: Record<number, number> = {}
  todaysOrders.forEach((o) => {
    const hour = new Date(o.created_at).getHours()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
  })
  const peakHourEntry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]
  const peakHour = peakHourEntry ? { hour: Number(peakHourEntry[0]), count: peakHourEntry[1] } : null

  // Excludes pos_status 'OPEN' — a table that was tapped but never had an
  // item added stays status='pending' forever with total_amount=0, which
  // would otherwise inflate this count with orders nothing was ever placed
  // for. "Active" here means actually sent to the kitchen (KOT_SENT and
  // beyond), matching the "in kitchen now" label on the dashboard tile.
  const { count: pendingOrders } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('cafe_id', DEMO_CAFE_ID)
    .not('status', 'in', '(completed,cancelled)')
    .neq('pos_status', 'OPEN')

  const { data: ingredientsRaw } = await supabase.from('ingredients').select('*').order('name', { ascending: true })
  const ingredients = (ingredientsRaw ?? []) as Ingredient[]
  const lowStockItems = ingredients.filter((i) => i.current_stock <= i.low_stock_threshold)
  const inventoryValuePaisa = ingredients.reduce((sum, i) => sum + i.current_stock * i.cost_per_unit_paisa, 0)

  const [{ data: sectionsRaw }, { data: tablesRaw }] = await Promise.all([
    supabase.from('sections').select('*').order('sort_order', { ascending: true }),
    supabase.from('tables').select('*').eq('cafe_id', DEMO_CAFE_ID).eq('is_active', true).order('number', { ascending: true }),
  ])
  const sections = ((sectionsRaw ?? []) as Section[]).map((section) => ({
    section,
    tables: ((tablesRaw ?? []) as Table[]).filter((t) => t.section_id === section.id),
  }))

  return {
    todaysSales,
    todaysProfit,
    ordersToday: todaysOrders.length,
    avgOrderValue: todaysOrders.length > 0 ? todaysSales / todaysOrders.length : 0,
    topSellerToday,
    topItemsToday: topItemsToday.slice(0, 5),
    mostVisitedArea,
    peakHour,
    pendingOrders: pendingOrders ?? 0,
    lowStockItems,
    inventoryValuePaisa,
    sections,
  }
}
