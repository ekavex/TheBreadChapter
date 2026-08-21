import type { Order } from '@/lib/types'
import { formatDistanceToNow } from 'date-fns'

const STATUS_STYLE: Record<string, string> = {
  pending:   'bg-green-50 text-green-700',
  confirmed: 'bg-blue-50 text-blue-700',
  making:    'bg-amber-50 text-amber-700',
  ready:     'bg-purple-50 text-purple-700',
  served:    'bg-gray-100 text-gray-600',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-50 text-red-600',
}

interface Props { orders: Order[] }

export default function RecentOrders({ orders }: Props) {
  return (
    <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
      <h2 className="font-display text-lg font-semibold mb-4">Recent orders</h2>
      {orders.length === 0 ? (
        <p className="text-ink-muted text-sm">No orders yet today</p>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{order.order_number}</span>
                  <span className="text-xs text-ink-muted">
                    {(order as any).table?.label || ((order as any).table?.number != null ? `Table ${(order as any).table.number}` : '—')}
                  </span>
                </div>
                <div className="text-xs text-ink-faint mt-0.5">
                  {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                </div>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[order.status]}`}>
                {order.status}
              </span>
              <span className="text-sm font-semibold text-ink">
                ₹{Math.round(order.total_amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
