import { getDb } from '@/lib/db'
import { getDashboardData } from '@/lib/dashboard'
import DashboardMetrics from '@/components/dashboard/DashboardMetrics'
import RecentOrders from '@/components/dashboard/RecentOrders'
import SmartCafeTiles from '@/components/dashboard/SmartCafeTiles'
import LowStockPreview from '@/components/dashboard/LowStockPreview'
import LiveTableGrid from '@/components/dashboard/LiveTableGrid'
import DashboardLiveRefresher from '@/components/dashboard/DashboardLiveRefresher'
import { startOfDay, endOfDay } from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Order } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const sql = getDb()
  const today = new Date()
  const startISO = startOfDay(today).toISOString()
  const endISO = endOfDay(today).toISOString()

  // Recent orders list (getDashboardData returns aggregates, not the raw list)
  const recentOrdersRaw = await sql`
    SELECT o.* FROM orders o
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND o.created_at >= ${startISO}
      AND o.created_at <= ${endISO}
      AND o.pos_status != 'OPEN'
    ORDER BY o.created_at DESC
    LIMIT 10
  `
  const rawOrders = recentOrdersRaw as unknown as { id: string }[]
  const orderIds = rawOrders.map((o) => o.id)
  const allItemsRaw = orderIds.length
    ? await sql`SELECT * FROM order_items WHERE order_id = ANY(${sql.array(orderIds)}::uuid[])`
    : []
  const allItems = allItemsRaw as unknown as { order_id: string }[]
  const recentOrders: Order[] = rawOrders.map((o) => ({
    ...o,
    items: allItems.filter((i) => i.order_id === o.id),
  })) as Order[]

  const data = await getDashboardData()

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <DashboardLiveRefresher />
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-ink">Good morning</h1>
        <p className="text-ink-muted mt-1">
          {today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <DashboardMetrics
        orderCount={data.ordersToday}
        revenue={data.todaysSales}
        activeOrders={data.pendingOrders}
        avgOrderValue={data.avgOrderValue}
      />

      <div className="mt-6">
        <SmartCafeTiles
          todaysProfit={data.todaysProfit}
          topSellerToday={data.topSellerToday}
          mostVisitedArea={data.mostVisitedArea}
          peakHour={data.peakHour}
          inventoryValuePaisa={data.inventoryValuePaisa}
          lowStockCount={data.lowStockItems.length}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <RecentOrders orders={recentOrders.slice(0, 10)} />

        {/* Top items */}
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Top items today</h2>
          <div className="space-y-3">
            {data.topItemsToday.length === 0 && (
              <p className="text-ink-muted text-sm">No orders yet today</p>
            )}
            {data.topItemsToday.map((item, i) => (
              <div key={item.name} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-ink">{item.name}</span>
                <span className="text-sm font-semibold text-ink-muted">{item.count} sold</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <LowStockPreview items={data.lowStockItems} />
        <LiveTableGrid sections={data.sections} />
      </div>
    </div>
  )
}
