// Module 10 "Live Dashboard" - today's sales/profit, low-stock items, top
// seller, most-visited area, peak hour, pending orders, inventory value,
// live table statuses.
import { startOfDay, endOfDay } from 'date-fns'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Ingredient, Section, Table } from '@/lib/types'

export interface NamedCount {
  name: string
  count: number
}

export interface DashboardData {
  todaysSales: number
  todaysProfit: number
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

export async function getDashboardData(): Promise<DashboardData> {
  const sql = getDb()
  const today = new Date()
  const startISO = startOfDay(today).toISOString()
  const endISO = endOfDay(today).toISOString()

  // Fetch all today's orders (excluding bare OPEN orders with no items)
  const allOrders = await sql`
    SELECT o.id, o.total_amount, o.payment_status, o.created_at, o.table_id
    FROM orders o
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.created_at >= ${startISO}
      AND o.created_at <= ${endISO}
      AND o.pos_status != 'OPEN'
  `

  // Fetch items (with cost) and section name for those orders in parallel
  type OrderRow = { id: string; total_amount: number; payment_status: string; created_at: string; table_id: string | null }
  type Item = { order_id: string; name: string; quantity: number; cost_price_paisa: number | null }

  const ordArr = allOrders as unknown as OrderRow[]
  const orderIds = ordArr.map((o) => o.id)
  const tableIds = Array.from(new Set(ordArr.map((o) => o.table_id).filter((id): id is string => !!id)))

  const [allItems, allTables] = await Promise.all([
    orderIds.length
      ? sql`
          SELECT oi.order_id, oi.name, oi.quantity, mi.cost_price_paisa
          FROM order_items oi
          LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
          WHERE oi.order_id = ANY(${sql.array(orderIds)}::uuid[])
        `
      : Promise.resolve([]),
    tableIds.length
      ? sql`
          SELECT t.id, s.name AS section_name
          FROM tables t
          LEFT JOIN sections s ON s.id = t.section_id
          WHERE t.id = ANY(${sql.array(tableIds)}::uuid[])
        `
      : Promise.resolve([]),
  ])

  // Build lookup maps
  const itemsByOrder = new Map<string, Item[]>()
  for (const item of allItems as unknown as Item[]) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }
  const sectionByTable = new Map<string, string>((allTables as unknown as { id: string; section_name: string | null }[]).map((t) => [t.id, t.section_name ?? 'Unseated']))

  const todaysOrders = ordArr.map((o) => ({
    ...o,
    items: itemsByOrder.get(o.id) ?? [],
    sectionName: o.table_id ? (sectionByTable.get(o.table_id) ?? 'Unseated') : null,
  }))

  const paidOrders = todaysOrders.filter((o) => o.payment_status === 'paid')
  const todaysSales = paidOrders.reduce((sum, o) => sum + o.total_amount, 0)
  const todaysCost = paidOrders.reduce((sum, o) => {
    return sum + o.items.reduce((s, i) => s + ((i.cost_price_paisa ?? 0) / 100) * i.quantity, 0)
  }, 0)
  const todaysProfit = todaysSales - todaysCost

  const itemCounts: Record<string, number> = {}
  todaysOrders.forEach((o) =>
    o.items.forEach((i) => {
      itemCounts[i.name] = (itemCounts[i.name] ?? 0) + i.quantity
    })
  )
  const topItemsToday = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  const topSellerToday = topItemsToday[0] ?? null

  const areaCounts: Record<string, number> = {}
  todaysOrders.forEach((o) => {
    if (o.sectionName) areaCounts[o.sectionName] = (areaCounts[o.sectionName] ?? 0) + 1
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

  const [pendingResult, ingredientsRaw, sectionsRaw, tablesRaw] = await Promise.all([
    sql`
      SELECT count(*) FROM orders
      WHERE cafe_id = ${DEMO_CAFE_ID}
        AND status NOT IN ('completed', 'cancelled')
        AND pos_status != 'OPEN'
    `,
    sql`SELECT * FROM ingredients ORDER BY name ASC`,
    sql`SELECT * FROM sections ORDER BY sort_order ASC`,
    sql`SELECT * FROM tables WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY number ASC`,
  ])

  const pendingOrders = Number((pendingResult[0] as unknown as { count: string }).count)
  const ingredients = ingredientsRaw as unknown as Ingredient[]
  const lowStockItems = ingredients.filter((i) => i.current_stock <= i.low_stock_threshold)
  const inventoryValuePaisa = ingredients.reduce((sum, i) => sum + i.current_stock * i.cost_per_unit_paisa, 0)

  const sections = (sectionsRaw as unknown as Section[]).map((section) => ({
    section,
    tables: (tablesRaw as unknown as Table[]).filter((t) => t.section_id === section.id),
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
    pendingOrders,
    lowStockItems,
    inventoryValuePaisa,
    sections,
  }
}
