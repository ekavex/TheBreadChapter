import { formatPaisa } from '@/lib/money'
import type { NamedCount } from '@/lib/dashboard'

interface Props {
  todaysProfit: number
  topSellerToday: NamedCount | null
  mostVisitedArea: NamedCount | null
  peakHour: { hour: number; count: number } | null
  inventoryValuePaisa: number
  lowStockCount: number
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${period}`
}

export default function SmartCafeTiles({
  todaysProfit,
  topSellerToday,
  mostVisitedArea,
  peakHour,
  inventoryValuePaisa,
  lowStockCount,
}: Props) {
  const tiles = [
    {
      label: "Today's profit",
      value: `₹${Math.round(todaysProfit).toLocaleString('en-IN')}`,
      sub: 'revenue − ingredient cost',
      accent: todaysProfit < 0 ? 'text-status-overdue' : 'text-green-600',
    },
    {
      label: 'Top seller today',
      value: topSellerToday?.name ?? '-',
      sub: topSellerToday ? `${topSellerToday.count} sold` : 'no orders yet',
      accent: 'text-brand-500',
    },
    {
      label: 'Most visited area',
      value: mostVisitedArea?.name ?? '-',
      sub: mostVisitedArea ? `${mostVisitedArea.count} orders today` : 'no orders yet',
      accent: 'text-blue-600',
    },
    {
      label: 'Peak hour',
      value: peakHour ? formatHour(peakHour.hour) : '-',
      sub: peakHour ? `${peakHour.count} orders` : 'no orders yet',
      accent: 'text-purple-600',
    },
    {
      label: 'Inventory value',
      value: formatPaisa(inventoryValuePaisa),
      sub: 'current stock × cost',
      accent: 'text-ink',
    },
    {
      label: 'Low stock items',
      value: lowStockCount.toString(),
      sub: lowStockCount > 0 ? 'need restocking' : 'all good',
      accent: lowStockCount > 0 ? 'text-status-overdue' : 'text-green-600',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-surface-raised rounded-2xl border border-ink/5 p-4">
          <p className="text-xs text-ink-faint font-medium uppercase tracking-wide mb-2">{t.label}</p>
          <p className={`text-xl font-display font-bold truncate ${t.accent}`}>{t.value}</p>
          <p className="text-xs text-ink-muted mt-1">{t.sub}</p>
        </div>
      ))}
    </div>
  )
}
