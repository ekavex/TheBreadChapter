'use client'
import { useOrderStatus } from '@/lib/hooks/useKitchenOrders'
import type { Order, OrderStatus } from '@/lib/types'
import { CheckCircle2, Clock, ChefHat, Bell, CircleCheck } from 'lucide-react'
import Link from 'next/link'

const STEPS: { status: OrderStatus; label: string; icon: React.ElementType }[] = [
  { status: 'confirmed', label: 'Confirmed',   icon: CheckCircle2 },
  { status: 'making',   label: 'Being made',   icon: ChefHat },
  { status: 'ready',    label: 'Ready',         icon: Bell },
  { status: 'served',   label: 'Served',        icon: CircleCheck },
]

const STATUS_ORDER: OrderStatus[] = ['pending', 'confirmed', 'making', 'ready', 'served', 'completed']

function stepIndex(status: OrderStatus) {
  return STATUS_ORDER.indexOf(status)
}

interface Props { initialOrder: Order }

export default function OrderTracker({ initialOrder }: Props) {
  const live = useOrderStatus(initialOrder.id)
  const order = live ?? initialOrder

  const isCancelled = order.status === 'cancelled'
  const isDone = order.status === 'completed' || order.status === 'served'
  const currentIdx = stepIndex(order.status)

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs text-ink-faint uppercase tracking-widest font-medium mb-1">Order</p>
          <h1 className="font-display text-3xl font-bold text-ink">{order.order_number}</h1>
          <p className="text-ink-muted text-sm mt-1">
            {order.items?.length ?? 0} items · ₹{Math.round(order.total_amount)}
          </p>
        </div>

        {/* Status card */}
        {isCancelled ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center mb-6">
            <p className="font-semibold text-red-700 text-lg">Order cancelled</p>
            <p className="text-red-500 text-sm mt-1">Please contact staff for assistance</p>
          </div>
        ) : (
          <div className="bg-surface-raised rounded-2xl border border-ink/5 p-6 mb-6">
            {/* Progress steps */}
            <div className="flex items-center justify-between relative mb-6">
              {/* connector line */}
              <div className="absolute left-0 right-0 top-5 h-0.5 bg-surface-overlay -z-0" />
              <div
                className="absolute left-0 top-5 h-0.5 bg-brand-400 transition-all duration-700 -z-0"
                style={{
                  width: `${Math.min(((currentIdx - 1) / (STEPS.length - 1)) * 100, 100)}%`
                }}
              />

              {STEPS.map((step, i) => {
                const stepIdx = stepIndex(step.status)
                const done = currentIdx >= stepIdx
                const active = order.status === step.status
                const Icon = step.icon
                return (
                  <div key={step.status} className="flex flex-col items-center gap-1.5 z-10">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                      done
                        ? 'bg-brand-400 border-brand-400'
                        : 'bg-surface border-ink/15'
                    } ${active ? 'ring-4 ring-brand-100' : ''}`}>
                      <Icon size={18} className={done ? 'text-white' : 'text-ink-faint'} />
                    </div>
                    <span className={`text-xs font-medium text-center leading-tight ${
                      active ? 'text-brand-600' : done ? 'text-ink-muted' : 'text-ink-faint'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Current status message */}
            <div className="text-center">
              {order.status === 'pending' && (
                <div className="flex items-center justify-center gap-2 text-amber-600">
                  <Clock size={16} className="animate-pulse" />
                  <span className="text-sm font-medium">Waiting for confirmation…</span>
                </div>
              )}
              {order.status === 'confirmed' && (
                <p className="text-sm text-ink-muted">Order confirmed — kitchen is on it</p>
              )}
              {order.status === 'making' && (
                <div className="flex items-center justify-center gap-2 text-brand-500">
                  <ChefHat size={16} />
                  <span className="text-sm font-medium">Your order is being prepared</span>
                </div>
              )}
              {order.status === 'ready' && (
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Bell size={16} className="animate-bounce" />
                  <span className="text-sm font-semibold">Your order is ready!</span>
                </div>
              )}
              {isDone && (
                <p className="text-sm text-ink-muted">Enjoy your meal!</p>
              )}
            </div>
          </div>
        )}

        {/* Order items */}
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5 mb-6">
          <h2 className="font-display font-semibold text-ink mb-3">Your order</h2>
          <div className="space-y-2">
            {(order.items ?? []).map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-surface-overlay text-xs font-semibold text-ink-muted flex items-center justify-center flex-shrink-0">
                  {item.quantity}
                </span>
                <span className="flex-1 text-sm text-ink">{item.name}</span>
                <span className="text-sm font-semibold text-ink">₹{item.subtotal}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-ink/5 mt-3 pt-3 flex justify-between">
            <span className="text-sm font-semibold text-ink">Total</span>
            <span className="text-sm font-semibold text-ink">₹{Math.round(order.total_amount)}</span>
          </div>
        </div>

        {/* Back to menu */}
        <Link
          href="/menu/1?cafe=sunrise-cafe"
          className="block w-full text-center text-sm text-ink-muted hover:text-ink py-3 transition-colors"
        >
          ← Back to menu
        </Link>
      </div>
    </div>
  )
}
