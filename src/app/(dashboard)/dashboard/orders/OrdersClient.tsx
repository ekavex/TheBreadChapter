'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import type { Order, OrderStatus } from '@/lib/types'
import toast from 'react-hot-toast'

const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'making', 'ready', 'served', 'completed', 'cancelled']

const STATUS_STYLE: Record<string, string> = {
  pending:   'bg-green-50 text-green-700 border-green-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  making:    'bg-amber-50 text-amber-700 border-amber-200',
  ready:     'bg-purple-50 text-purple-700 border-purple-200',
  served:    'bg-gray-100 text-gray-600 border-gray-200',
  completed: 'bg-gray-50 text-gray-500 border-gray-100',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending:   'confirmed',
  confirmed: 'making',
  making:    'ready',
  ready:     'served',
  served:    'completed',
}

interface Props {
  orders: Order[]
  currentDate: string
  availableDates: string[]
  activeStatus: string
}

export default function OrdersClient({ orders, currentDate, availableDates, activeStatus }: Props) {
  const router = useRouter()
  const [updating, setUpdating] = useState<string | null>(null)

  const filtered = activeStatus === 'all'
    ? orders
    : orders.filter(o => o.status === activeStatus)

  function setDate(date: string) {
    router.push(`/dashboard/orders?date=${date}`)
  }

  function setStatus(status: string) {
    router.push(`/dashboard/orders?date=${currentDate}&status=${status}`)
  }

  async function advanceStatus(order: Order) {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    setUpdating(order.id)
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, status: next }),
      })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success(`${order.order_number} → ${next}`)
      router.refresh()
    } catch {
      toast.error('Status update failed')
    } finally {
      setUpdating(null)
    }
  }

  const totalRevenue = orders
    .filter(o => o.payment_status === 'paid')
    .reduce((s, o) => s + o.total_amount, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Orders</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {orders.length} orders · ₹{Math.round(totalRevenue).toLocaleString('en-IN')} collected
          </p>
        </div>

        {/* Date picker */}
        <div className="relative">
          <select
            value={currentDate}
            onChange={e => setDate(e.target.value)}
            className="appearance-none bg-surface-raised border border-ink/10 text-sm text-ink rounded-xl px-4 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            {availableDates.map(d => (
              <option key={d} value={d}>
                {format(parseISO(d), 'd MMM')}
                {d === availableDates[0] ? ' (Today)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap mb-5">
        {(['all', ...STATUSES]).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              activeStatus === s
                ? 'bg-ink text-surface border-ink'
                : 'bg-surface-raised text-ink-muted border-ink/10 hover:border-ink/25'
            }`}
          >
            {s === 'all' ? `All (${orders.length})` : s}
          </button>
        ))}
      </div>

      {/* Orders table */}
      {filtered.length === 0 ? (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-10 text-center">
          <p className="text-ink-muted text-sm">No orders for this filter</p>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/5 bg-surface-overlay">
                <th className="text-left px-5 py-3 text-xs font-semibold text-ink-faint uppercase tracking-wide">Order</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-faint uppercase tracking-wide">Table</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-faint uppercase tracking-wide">Items</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-faint uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-ink-faint uppercase tracking-wide">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {filtered.map(order => {
                const nextStatus = NEXT_STATUS[order.status]
                const tableInfo = (order as any).table
                return (
                  <tr key={order.id} className="hover:bg-surface-overlay/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-ink">{order.order_number}</span>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {format(new Date(order.created_at), 'h:mm a')}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-ink-muted">
                      {tableInfo ? `Table ${tableInfo.number}` : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-ink-muted">{(order.items ?? []).length} items</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[order.status]}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-ink">
                      ₹{Math.round(order.total_amount)}
                    </td>
                    <td className="px-4 py-3.5">
                      {nextStatus && (
                        <button
                          onClick={() => advanceStatus(order)}
                          disabled={updating === order.id}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40 whitespace-nowrap"
                        >
                          {updating === order.id ? '...' : `→ ${nextStatus}`}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
