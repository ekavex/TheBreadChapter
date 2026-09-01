'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ArrowRight, X, Printer, FileDown, ChevronRight, Trash2 } from 'lucide-react'
import type { Order, OrderStatus, OrderItem, UserRole } from '@/lib/types'
import { ConfirmModal } from '@/components/dashboard/ConfirmModal'
import toast from 'react-hot-toast'

function readRoleCookie(): UserRole {
  if (typeof document === 'undefined') return 'manager'
  const match = document.cookie.match(/(?:^|;\s*)sc_role=([^;]+)/)
  const val = match?.[1]
  if (val === 'admin' || val === 'manager' || val === 'staff') return val
  return 'manager'
}

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

// ─── Order detail popup print ────────────────────────────────────────────────

// Queues a thermal reprint on the beverage/bill printer via the Android print
// bridge - the same Bluetooth-routed pipeline the POS checkout screen uses,
// rather than the browser's own print dialog (which has no notion of which
// physical printer should receive it).
async function reprintBill(order: Order) {
  try {
    const res = await fetch(`/api/pos/orders/${order.id}/reprint-bill`, { method: 'POST' })
    const { error } = await res.json()
    if (error) throw new Error(error)
    toast.success('Sent to printer')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to print')
  }
}

function downloadReceipt(orderId: string) {
  window.location.assign(`/api/orders/${orderId}/receipt`)
}

// ─── Order detail drawer ─────────────────────────────────────────────────────

function OrderDetailDrawer({ order, onClose, onAdvance, advancing, isAdmin, onDelete, deleting }: {
  order: Order
  onClose: () => void
  onAdvance: (order: Order) => void
  advancing: boolean
  isAdmin: boolean
  onDelete: (order: Order) => void
  deleting: boolean
}) {
  const items: OrderItem[] = (order.items ?? []) as OrderItem[]
  const tableInfo = (order as any).table
  const tableLabel = tableInfo?.label ?? (tableInfo?.number ? `Table ${tableInfo.number}` : 'Takeaway')
  const nextStatus = NEXT_STATUS[order.status]
  const note = (order as any).customer_note as string | null | undefined
  const [printCooldown, setPrintCooldown] = useState(false)

  const subtotal = items.reduce((s, i) => s + ((i as any).subtotal ?? 0), 0)

  function handlePrint() {
    setPrintCooldown(true)
    reprintBill(order)
    setTimeout(() => setPrintCooldown(false), 3000)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-surface shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/5 bg-surface-raised shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-ink text-base">{order.order_number}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_STYLE[order.status]}`}>
                {order.status}
              </span>
              {order.payment_status === 'paid' && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                  paid
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              {tableLabel} · {format(new Date(order.created_at), 'd MMM, h:mm a')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-ink-muted hover:bg-surface-overlay transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Items */}
          <div className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-overlay border-b border-ink/5">
              <p className="text-xs font-semibold text-ink-faint uppercase tracking-wide">Items</p>
            </div>
            <div className="divide-y divide-ink/5">
              {items.length === 0 && (
                <p className="px-4 py-3 text-sm text-ink-faint">No items</p>
              )}
              {items.map((item, i) => {
                const addons = ((item as any).addons_json ?? []) as { name: string }[]
                return (
                  <div key={(item as any).id ?? i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex gap-2 flex-1 min-w-0">
                        <span className="text-xs font-bold text-ink-muted bg-surface-overlay px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                          ×{item.quantity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink leading-tight">{item.name}</p>
                          {addons.length > 0 && (
                            <p className="text-xs text-ink-muted mt-0.5">{addons.map(a => a.name).join(' · ')}</p>
                          )}
                          {(item as any).customisation && (
                            <p className="text-xs text-ink-faint italic mt-0.5">{(item as any).customisation}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-ink shrink-0">
                        ₹{Math.round((item as any).subtotal ?? 0)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Customer note */}
          {note?.trim() && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-4 py-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Customer note</p>
              <p className="text-sm text-amber-800 dark:text-amber-300">{note.trim()}</p>
            </div>
          )}

          {/* Total */}
          <div className="bg-surface-raised rounded-2xl border border-ink/5 px-4 py-3 space-y-2">
            {subtotal !== order.total_amount && (
              <div className="flex justify-between text-sm text-ink-muted">
                <span>Subtotal</span>
                <span>₹{Math.round(subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-ink">
              <span>Total</span>
              <span>₹{Math.round(order.total_amount)}</span>
            </div>
            <div className="border-t border-ink/5 pt-2 flex justify-between text-xs text-ink-muted">
              <span>Payment</span>
              <span className="capitalize">{order.payment_status === 'paid' ? `Paid · ${(order as any).payment_method ?? 'UPI'}` : order.payment_status}</span>
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t border-ink/5 bg-surface-raised px-5 py-4 flex items-center gap-3">
          {nextStatus && (
            <button
              onClick={() => onAdvance(order)}
              disabled={advancing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-600 transition-colors"
            >
              <ChevronRight size={14} />
              {advancing ? 'Updating…' : `Mark ${nextStatus}`}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handlePrint}
              disabled={printCooldown}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-ink/10 text-sm text-ink-muted hover:bg-surface-overlay transition-colors disabled:opacity-50"
              title="Print receipt"
            >
              <Printer size={14} /> Print
            </button>
            <button
              onClick={() => downloadReceipt(order.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-ink/10 text-sm text-ink-muted hover:bg-surface-overlay transition-colors"
              title="Download receipt"
            >
              <FileDown size={14} /> Download
            </button>
            {isAdmin && (
              <button
                onClick={() => onDelete(order)}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                title="Delete order permanently"
              >
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function OrdersClient({ orders, currentDate, availableDates, activeStatus }: Props) {
  const router = useRouter()
  const [updating, setUpdating] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Order | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => { setIsAdmin(readRoleCookie() === 'admin') }, [])

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
      // Update selected order state too
      setSelectedOrder(prev => prev?.id === order.id ? { ...prev, status: next } : prev)
      router.refresh()
    } catch {
      toast.error('Status update failed')
    } finally {
      setUpdating(null)
    }
  }

  async function deleteOrder(order: Order) {
    setDeleting(order.id)
    try {
      const res = await fetch(`/api/pos/orders/${order.id}`, { method: 'DELETE' })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success(`${order.order_number} deleted`)
      setSelectedOrder(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete order')
    } finally {
      setDeleting(null)
    }
  }

  const totalRevenue = orders
    .filter(o => o.payment_status === 'paid')
    .reduce((s, o) => s + o.total_amount, 0)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Orders</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {orders.length} orders · ₹{Math.round(totalRevenue).toLocaleString('en-IN')} collected
          </p>
        </div>

        {/* Date picker */}
        <div className="relative shrink-0">
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
      <div className="flex gap-2 flex-wrap mb-5 overflow-x-auto pb-1">
        {(['all', ...STATUSES]).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              activeStatus === s
                ? 'bg-ink text-surface border-ink'
                : 'bg-surface-raised text-ink-muted border-ink/10 hover:border-ink/25'
            }`}
          >
            {s === 'all' ? `All (${orders.length})` : s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-10 text-center">
          <p className="text-ink-muted text-sm">No orders for this filter</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table (md+) ── */}
          <div className="hidden md:block bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
            <div className="overflow-x-auto">
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
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className="hover:bg-surface-overlay/50 transition-colors cursor-pointer"
                      >
                        <td className="px-5 py-3.5">
                          <span className="font-semibold text-ink">{order.order_number}</span>
                          <p className="text-xs text-ink-faint mt-0.5">{format(new Date(order.created_at), 'h:mm a')}</p>
                        </td>
                        <td className="px-4 py-3.5 text-ink-muted">
                          {tableInfo?.label ?? (tableInfo?.number ? `Table ${tableInfo.number}` : '-')}
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
                        <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
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
          </div>

          {/* ── Mobile cards (< md) ── */}
          <div className="md:hidden space-y-3">
            {filtered.map(order => {
              const nextStatus = NEXT_STATUS[order.status]
              const tableInfo = (order as any).table
              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="bg-surface-raised rounded-2xl border border-ink/5 p-4 cursor-pointer active:scale-[.99] transition-transform"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <span className="font-semibold text-ink">{order.order_number}</span>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {format(new Date(order.created_at), 'h:mm a')} · {tableInfo?.label ?? (tableInfo?.number ? `Table ${tableInfo.number}` : 'Takeaway')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLE[order.status]}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-muted">{(order.items ?? []).length} items</span>
                    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <span className="font-semibold text-ink">₹{Math.round(order.total_amount)}</span>
                      {nextStatus && (
                        <button
                          onClick={() => advanceStatus(order)}
                          disabled={updating === order.id}
                          className="flex items-center gap-1 text-xs font-medium text-white bg-brand-500 hover:bg-brand-600 px-3 py-1.5 rounded-xl disabled:opacity-40 transition-colors"
                        >
                          {updating === order.id ? '…' : (
                            <><ArrowRight size={11} /> {nextStatus}</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Order detail drawer */}
      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onAdvance={advanceStatus}
          advancing={updating === selectedOrder.id}
          isAdmin={isAdmin}
          onDelete={setPendingDelete}
          deleting={deleting === selectedOrder.id}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete order?"
          message={`Delete order ${pendingDelete.order_number} permanently? This cannot be undone.`}
          onConfirm={() => { const order = pendingDelete; setPendingDelete(null); void deleteOrder(order) }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
