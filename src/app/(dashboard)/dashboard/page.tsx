import { createServerSupabaseClient } from '@/lib/supabase/server'
import { startOfDay, endOfDay } from 'date-fns'
import DashboardMetrics from '@/components/dashboard/DashboardMetrics'
import RecentOrders from '@/components/dashboard/RecentOrders'
import type { Order } from '@/lib/types'

const DEMO_CAFE_ID = '11111111-1111-1111-1111-111111111111'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient()
  const today = new Date()

  // Today's orders
  const { data: orders } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('cafe_id', DEMO_CAFE_ID)
    .gte('created_at', startOfDay(today).toISOString())
    .lte('created_at', endOfDay(today).toISOString())
    .order('created_at', { ascending: false })

  // `pos_status` is a CHECK-constrained TEXT column — the DB guarantees one of
  // PosStatus's values, but postgrest's generated Row type can't narrow that.
  const todayOrders = (orders ?? []) as Order[]
  const revenue = todayOrders
    .filter(o => o.payment_status === 'paid')
    .reduce((sum, o) => sum + o.total_amount, 0)

  // Top items today
  const itemCounts: Record<string, { name: string; count: number }> = {}
  todayOrders.forEach(order => {
    (order.items ?? []).forEach((item: any) => {
      if (!itemCounts[item.name]) itemCounts[item.name] = { name: item.name, count: 0 }
      itemCounts[item.name].count += item.quantity
    })
  })
  const topItems = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 5)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-ink">Good morning</h1>
        <p className="text-ink-muted mt-1">
          {today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <DashboardMetrics
        orderCount={todayOrders.length}
        revenue={revenue}
        activeOrders={todayOrders.filter(o => !['completed', 'cancelled'].includes(o.status)).length}
        avgOrderValue={todayOrders.length > 0 ? revenue / todayOrders.length : 0}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <RecentOrders orders={todayOrders.slice(0, 10)} />

        {/* Top items */}
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Top items today</h2>
          <div className="space-y-3">
            {topItems.length === 0 && (
              <p className="text-ink-muted text-sm">No orders yet today</p>
            )}
            {topItems.map((item, i) => (
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
    </div>
  )
}
