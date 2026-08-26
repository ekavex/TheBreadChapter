interface Props {
  orderCount: number
  revenue: number
  activeOrders: number
  avgOrderValue: number
}

export default function DashboardMetrics({ orderCount, revenue, activeOrders, avgOrderValue }: Props) {
  const metrics = [
    {
      label: "Today's revenue",
      value: `₹${Math.round(revenue).toLocaleString('en-IN')}`,
      sub: 'from paid orders',
      accent: 'text-green-600',
    },
    {
      label: 'Orders today',
      value: orderCount.toString(),
      sub: `${activeOrders} still active`,
      accent: 'text-brand-500',
    },
    {
      label: 'Avg. order value',
      value: avgOrderValue > 0 ? `₹${Math.round(avgOrderValue)}` : '—',
      sub: 'per order',
      accent: 'text-blue-600',
    },
    {
      label: 'Active orders',
      value: activeOrders.toString(),
      sub: 'in barista now',
      accent: activeOrders > 5 ? 'text-red-500' : 'text-amber-500',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {metrics.map(m => (
        <div key={m.label} className="bg-surface-raised rounded-2xl border border-ink/5 p-4">
          <p className="text-xs text-ink-faint font-medium uppercase tracking-wide mb-2">{m.label}</p>
          <p className={`text-2xl font-display font-bold ${m.accent}`}>{m.value}</p>
          <p className="text-xs text-ink-muted mt-1">{m.sub}</p>
        </div>
      ))}
    </div>
  )
}
