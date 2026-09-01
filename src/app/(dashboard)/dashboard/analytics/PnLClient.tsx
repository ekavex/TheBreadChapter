'use client'
import { useState } from 'react'
import type { PnLData } from '@/lib/analytics'
import { formatPaisa } from '@/lib/money'

type Range = 'daily' | 'weekly' | 'monthly' | 'yearly'

const RANGES: Range[] = ['daily', 'weekly', 'monthly', 'yearly']

export default function PnLClient({ initial }: { initial: Record<Range, PnLData> }) {
  const [range, setRange] = useState<Range>('monthly')
  const data = initial[range]
  const maxProfit = Math.max(...data.rows.map((r) => Math.max(r.profit, 0)), 1)

  return (
    <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h2 className="font-display font-semibold text-ink">Profit &amp; Loss</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                range === r ? 'bg-ink text-surface' : 'bg-surface-overlay text-ink-muted hover:text-ink'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Revenue', value: formatPaisa(Math.round(data.totals.revenue * 100)), accent: 'text-ink' },
          { label: 'Ingredient cost', value: formatPaisa(Math.round(data.totals.ingredientCost * 100)), accent: 'text-amber-600' },
          { label: 'Profit', value: formatPaisa(Math.round(data.totals.profit * 100)), accent: data.totals.profit < 0 ? 'text-status-overdue' : 'text-green-600' },
          { label: 'Margin', value: `${data.totals.marginPct.toFixed(1)}%`, accent: 'text-blue-600' },
        ].map((m) => (
          <div key={m.label} className="bg-surface-overlay rounded-xl p-3">
            <p className="text-[10px] text-ink-faint uppercase tracking-wide font-medium">{m.label}</p>
            <p className={`text-base font-display font-bold ${m.accent}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Per-period bars */}
      <div className="space-y-2">
        {data.rows.map((r, i) => (
          <div key={`${range}-${i}`} className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs text-ink-muted w-12 sm:w-16 shrink-0 truncate">{r.label}</span>
            <div className="flex-1 h-6 bg-surface-overlay rounded-lg overflow-hidden relative">
              <div
                className="h-full bg-green-400 rounded-lg flex items-center justify-end pr-2"
                style={{ width: `${Math.max((r.profit / maxProfit) * 100, r.profit > 0 ? 4 : 0)}%` }}
              >
                {r.profit > 0 && (
                  <span className="text-[10px] font-semibold text-white">{formatPaisa(Math.round(r.profit * 100))}</span>
                )}
              </div>
              {r.profit <= 0 && <span className="absolute left-2 top-1 text-[10px] text-status-overdue">-</span>}
            </div>
            <span className="text-xs text-ink-faint w-20 sm:w-28 shrink-0 text-right">
              {r.orderCount} · {r.marginPct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
