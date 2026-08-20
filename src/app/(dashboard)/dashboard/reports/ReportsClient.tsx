'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import type { ReportData, ReportRange } from '@/lib/reports'

interface Props {
  initial: ReportData
  ranges: ReportRange[]
}

function fmt(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportsClient({ initial, ranges }: Props) {
  const [data, setData] = useState<ReportData>(initial)
  const [range, setRange] = useState<ReportRange>('monthly')
  const [loading, setLoading] = useState(false)

  async function switchRange(r: ReportRange) {
    if (r === range) return
    setRange(r)
    setLoading(true)
    try {
      const res = await fetch(`/api/reports/${r}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setData(json.data)
    } finally {
      setLoading(false)
    }
  }

  const exportUrl = (format: 'csv' | 'excel' | 'pdf') => `/api/reports/${range}/export?format=${format}`

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 print-area">
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Reports</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {new Date(data.window.from).toLocaleDateString('en-IN')} → {new Date(data.window.to).toLocaleDateString('en-IN')}
          </p>
        </div>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => switchRange(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                range === r ? 'bg-ink text-surface' : 'bg-surface-overlay text-ink-muted hover:text-ink'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Export bar */}
      <div className="flex flex-wrap gap-2 no-print">
        <a href={exportUrl('csv')} download className="flex items-center gap-1.5 rounded-xl border border-ink/10 px-3 py-2 text-sm hover:bg-surface-overlay">
          <Download size={14} /> CSV
        </a>
        <a href={exportUrl('excel')} download className="flex items-center gap-1.5 rounded-xl border border-ink/10 px-3 py-2 text-sm hover:bg-surface-overlay">
          <Download size={14} /> Excel
        </a>
        <a href={exportUrl('pdf')} download className="flex items-center gap-1.5 rounded-xl border border-ink/10 px-3 py-2 text-sm hover:bg-surface-overlay">
          <Download size={14} /> PDF
        </a>
      </div>

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : (
        <>
          {/* Summary */}
          <section className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
            <h2 className="font-display font-semibold text-ink mb-4 capitalize">{range} summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { l: 'Revenue', v: fmt(data.summary.revenue) },
                { l: 'Ingredient cost', v: fmt(data.summary.ingredientCost) },
                { l: 'Profit', v: fmt(data.summary.profit) },
                { l: 'Margin', v: `${data.summary.marginPct.toFixed(1)}%` },
                { l: 'Orders', v: String(data.summary.orderCount) },
                { l: 'Avg order value', v: fmt(data.summary.avgOrderValue) },
                { l: 'Best day', v: data.summary.bestDay ? `${data.summary.bestDay.label} (${fmt(data.summary.bestDay.revenue)})` : '—' },
                { l: 'Worst day', v: data.summary.worstDay ? `${data.summary.worstDay.label} (${fmt(data.summary.worstDay.revenue)})` : '—' },
              ].map((m) => (
                <div key={m.l} className="bg-surface-overlay rounded-xl p-3">
                  <p className="text-[10px] text-ink-faint uppercase tracking-wide font-medium">{m.l}</p>
                  <p className="text-sm font-display font-bold text-ink truncate">{m.v}</p>
                </div>
              ))}
            </div>
          </section>

          <ReportTable title="Top selling items" headers={['Item', 'Qty', 'Revenue']} rows={data.topSellingItems.map((i) => [i.name, String(i.quantity), fmt(i.revenue)])} />
          <ReportTable title="Area performance" headers={['Area', 'Orders', 'Revenue', 'Top item']} rows={data.areaPerformance.map((a) => [a.area, String(a.orders), fmt(a.revenue), a.topItem ?? '—'])} />
          <ReportTable title="Ingredient usage" headers={['Ingredient', 'Quantity', 'Unit']} rows={data.ingredientUsage.map((i) => [i.name, String(i.quantity), i.unit])} />

          <section className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
            <h2 className="font-display font-semibold text-ink mb-4">Customer</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { l: 'Total customers', v: String(data.customer.totalCustomers) },
                { l: 'New', v: String(data.customer.newCustomers) },
                { l: 'Repeat', v: String(data.customer.repeatCustomers) },
                { l: 'Most ordered', v: data.customer.mostOrderedItem?.name ?? '—' },
                { l: 'Avg bill', v: fmt(data.customer.avgBillValue) },
              ].map((m) => (
                <div key={m.l} className="bg-surface-overlay rounded-xl p-3">
                  <p className="text-[10px] text-ink-faint uppercase tracking-wide font-medium">{m.l}</p>
                  <p className="text-sm font-display font-bold text-ink truncate">{m.v}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
      <h2 className="font-display font-semibold text-ink px-5 py-3 border-b border-ink/5">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No data in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-overlay text-left text-ink-faint">
                {headers.map((h) => (
                  <th key={h} className="px-5 py-2 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-5 py-2 text-ink">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
