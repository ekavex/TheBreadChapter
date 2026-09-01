import { getPnLData, getAreaAnalytics, getCustomerAnalytics, type PnLData } from '@/lib/analytics'
import PnLClient from './PnLClient'
import { formatPaisa } from '@/lib/money'

export const metadata = { title: 'Analytics' }
export const dynamic = 'force-dynamic'

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${period}`
}

export default async function AnalyticsPage() {
  // P&L across all four ranges up front - the range switcher is client-side
  // (no refetch). Each range is bounded so this stays light.
  const [daily, weekly, monthly, yearly, area, customer] = await Promise.all([
    getPnLData('daily'),
    getPnLData('weekly'),
    getPnLData('monthly'),
    getPnLData('yearly'),
    getAreaAnalytics(30),
    getCustomerAnalytics(30),
  ])

  const maxVisitors = Math.max(...area.visitors.map((v) => v.value), 1)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Analytics</h1>
        <p className="text-ink-muted text-sm mt-0.5">Profit &amp; loss, area, customer · last 30 days</p>
      </div>

      {/* P&L - Module 6 */}
      <PnLClient initial={{ daily, weekly, monthly, yearly }} />

      {/* Area analytics - Module 7 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          <h2 className="font-display font-semibold text-ink mb-4">Visitors by area</h2>
          {area.visitors.length === 0 ? (
            <p className="text-sm text-ink-muted">No orders in this period.</p>
          ) : (
            <div className="space-y-2">
              {area.visitors.map((v) => (
                <div key={v.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink">{v.name}</span>
                    <span className="text-ink-muted">{v.value} orders</span>
                  </div>
                  <div className="h-2 bg-surface-overlay rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full" style={{ width: `${(v.value / maxVisitors) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          <h2 className="font-display font-semibold text-ink mb-4">Popular items by area</h2>
          {area.popularByArea.length === 0 ? (
            <p className="text-sm text-ink-muted">No orders in this period.</p>
          ) : (
            <div className="space-y-3">
              {area.popularByArea.map((a) => (
                <div key={a.area}>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-faint mb-1">{a.area}</p>
                  <p className="text-sm text-ink">
                    {a.items.map((i) => i.name).join(', ') || '-'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5 md:col-span-2">
          <h2 className="font-display font-semibold text-ink mb-4">Peak hour by area</h2>
          {area.peakHourByArea.length === 0 ? (
            <p className="text-sm text-ink-muted">No orders in this period.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {area.peakHourByArea.map((a) => (
                <div key={a.area} className="bg-surface-overlay rounded-xl p-3">
                  <p className="text-xs text-ink-faint uppercase tracking-wide">{a.area}</p>
                  <p className="text-base font-display font-bold text-ink">
                    {a.peakHour ? formatHour(a.peakHour.hour) : '-'}
                  </p>
                  <p className="text-xs text-ink-muted">{a.peakHour ? `${a.peakHour.count} orders` : 'no data'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Customer analytics - Module 8 */}
      <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
        <h2 className="font-display font-semibold text-ink mb-4">Customer analytics</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Total customers', value: customer.totalCustomers.toString() },
            { label: 'New', value: customer.newCustomers.toString() },
            { label: 'Repeat', value: customer.repeatCustomers.toString() },
            { label: 'Most ordered item', value: customer.mostOrderedItem?.name ?? '-' },
            { label: 'Peak visiting hour', value: customer.peakVisitingHour ? formatHour(customer.peakVisitingHour.hour) : '-' },
            { label: 'Avg bill value', value: formatPaisa(Math.round(customer.avgBillValue * 100)) },
          ].map((m) => (
            <div key={m.label} className="bg-surface-overlay rounded-xl p-3">
              <p className="text-[10px] text-ink-faint uppercase tracking-wide font-medium">{m.label}</p>
              <p className="text-base font-display font-bold text-ink truncate">{m.value}</p>
            </div>
          ))}
        </div>
        {customer.totalCustomers === 0 && (
          <p className="text-xs text-ink-faint mt-3">
            No customers captured yet - customer identity is recorded only when a phone is entered at POS payment.
          </p>
        )}
      </div>
    </div>
  )
}
