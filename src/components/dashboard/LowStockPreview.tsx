import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { Ingredient } from '@/lib/types'

interface Props {
  items: Ingredient[]
}

// Module 10 "Low Stock Items" — e.g. "Bread < 20 pieces" preview on the dashboard.
export default function LowStockPreview({ items }: Props) {
  return (
    <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold">Low stock alerts</h2>
        <Link href="/dashboard/inventory" className="text-xs text-brand-500 hover:underline">
          View inventory →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">All ingredients are above their threshold.</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 6).map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-ink">
                <AlertTriangle size={13} className="text-status-overdue shrink-0" />
                {i.name}
              </span>
              <span className="text-status-overdue font-medium">
                {i.current_stock} {i.unit} <span className="text-ink-faint font-normal">(min {i.low_stock_threshold})</span>
              </span>
            </div>
          ))}
          {items.length > 6 && <p className="text-xs text-ink-faint">+ {items.length - 6} more</p>}
        </div>
      )}
    </div>
  )
}
