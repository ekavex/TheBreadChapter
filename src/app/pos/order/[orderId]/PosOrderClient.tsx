'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Trash2, Send, Receipt, CreditCard, XCircle, CheckCircle2 } from 'lucide-react'
import type { Order, MenuCategory, MenuItem, Payment, PosStatus } from '@/lib/types'

interface Props {
  initialOrder: Order
  categories: MenuCategory[]
}

const STATUS_LABELS: Record<PosStatus, string> = {
  OPEN: 'Open',
  KOT_SENT: 'KOT Sent',
  BILLED: 'Billed',
  AWAITING_PAYMENT: 'Awaiting Payment',
  PAID: 'Paid',
  PAYMENT_FAILED: 'Payment Failed',
  CANCELLED: 'Cancelled',
}

async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data as T
}

export default function PosOrderClient({ initialOrder, categories }: Props) {
  const router = useRouter()
  const [order, setOrder] = useState<Order>(initialOrder)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? '')
  const [paymentMode, setPaymentMode] = useState<'upi' | 'card' | 'cash'>('upi')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshOrder() {
    try {
      const fresh = await api<Order>(`/api/pos/orders/${order.id}`, 'GET')
      setOrder(fresh)
    } catch {
      // ignore — caller already surfaced an error
    }
  }

  async function addItem(item: MenuItem) {
    setBusy(true)
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/items`, 'POST', { menu_item_id: item.id, quantity: 1 })
      setOrder(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add item')
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(orderItemId: string) {
    setBusy(true)
    try {
      await api(`/api/pos/orders/${order.id}/items/${orderItemId}`, 'DELETE')
      await refreshOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove item')
    } finally {
      setBusy(false)
    }
  }

  async function sendToKitchen() {
    if ((order.items ?? []).length === 0) return toast.error('Add at least one item first')
    setBusy(true)
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/kot`, 'POST')
      setOrder(updated)
      toast.success('Sent to kitchen — KOT printed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send KOT')
    } finally {
      setBusy(false)
    }
  }

  async function generateBill() {
    setBusy(true)
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/bill`, 'POST')
      setOrder(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate bill')
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    setBusy(true)
    try {
      const result = await api<{ order: Order; payment: Payment }>(`/api/pos/orders/${order.id}/pay`, 'POST', {
        mode: paymentMode,
        customer_phone: customerPhone.trim() || null,
        customer_name: customerName.trim() || null,
      })
      setOrder(result.order)
      setPayment(result.payment)
      if (result.order.pos_status === 'PAID') toast.success('Payment approved')
      else toast.error('Payment declined — you can retry')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder() {
    if (!confirm('Cancel this order and release the table?')) return
    setBusy(true)
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/cancel`, 'POST')
      setOrder(updated)
      toast.success('Order cancelled')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order')
    } finally {
      setBusy(false)
    }
  }

  const items = order.items ?? []
  const runningSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0)
  const canCancel = !['PAID', 'CANCELLED'].includes(order.pos_status)
  const activeCategoryItems = categories.find((c) => c.id === activeCategory)?.items ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.push('/pos')} className="text-sm text-ink-muted hover:text-ink mb-1">
            ← Back to tables
          </button>
          <h1 className="font-display text-2xl font-bold text-ink">
            Table {order.table?.number} · {order.table?.section?.name}
          </h1>
          <p className="text-ink-muted text-sm mt-0.5">Order {order.order_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide bg-surface-overlay text-ink-muted px-3 py-1.5 rounded-full">
            {STATUS_LABELS[order.pos_status]}
          </span>
          {canCancel && (
            <button
              onClick={cancelOrder}
              disabled={busy}
              title="Cancel order"
              className="p-2 rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              <XCircle size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Menu browser — only while items can still be added */}
      {order.pos_status === 'OPEN' && (
        <div className="mb-6">
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat.id ? 'bg-ink text-surface' : 'bg-surface-overlay text-ink-muted hover:text-ink'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {activeCategoryItems.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                disabled={busy}
                className="text-left bg-surface-raised border border-ink/5 rounded-xl p-3 hover:border-ink/20 transition-colors disabled:opacity-50"
              >
                <p className="text-sm font-medium text-ink leading-tight">{item.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-ink-faint capitalize">{item.category}</span>
                  <span className="text-sm font-semibold text-ink">₹{item.price}</span>
                </div>
              </button>
            ))}
            {activeCategoryItems.length === 0 && (
              <p className="text-sm text-ink-faint col-span-full">No available items in this category.</p>
            )}
          </div>
        </div>
      )}

      {/* Order items */}
      <div className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-ink/5 bg-surface-overlay">
          <h2 className="font-display font-semibold text-ink text-sm">Order items</h2>
        </div>
        <div className="divide-y divide-ink/5">
          {items.length === 0 && <p className="px-5 py-4 text-sm text-ink-faint">No items yet.</p>}
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3">
              <span className="text-xs uppercase tracking-wide text-ink-faint bg-surface-overlay px-1.5 py-0.5 rounded shrink-0">
                {item.category}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">{item.name} × {item.quantity}</p>
                {item.customisation && <p className="text-xs text-ink-faint">{item.customisation}</p>}
              </div>
              <span className="text-sm font-semibold text-ink shrink-0">₹{item.subtotal}</span>
              {order.pos_status === 'OPEN' && (
                <button
                  onClick={() => removeItem(item.id)}
                  disabled={busy}
                  className="p-1.5 rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="px-5 py-3 border-t border-ink/5 flex justify-between text-sm">
            <span className="text-ink-muted">
              {['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(order.pos_status) ? 'Subtotal' : 'Running total'}
            </span>
            <span className="font-semibold text-ink">
              ₹{['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(order.pos_status) ? order.subtotal : runningSubtotal}
            </span>
          </div>
        )}
        {['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(order.pos_status) && (
          <div className="px-5 pb-3 space-y-1 text-sm">
            {order.tax_amount > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>Tax</span><span>₹{order.tax_amount}</span>
              </div>
            )}
            {order.service_charge > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>Service charge</span><span>₹{order.service_charge}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-ink border-t border-ink/10 pt-1">
              <span>Total</span><span>₹{order.total_amount}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action area, per state */}
      {order.pos_status === 'OPEN' && (
        <button
          onClick={sendToKitchen}
          disabled={busy || items.length === 0}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
        >
          <Send size={16} /> Send to Kitchen
        </button>
      )}

      {order.pos_status === 'KOT_SENT' && (
        <button
          onClick={generateBill}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
        >
          <Receipt size={16} /> Generate Bill
        </button>
      )}

      {(order.pos_status === 'BILLED' || order.pos_status === 'PAYMENT_FAILED') && (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          {order.pos_status === 'PAYMENT_FAILED' && (
            <p className="text-sm text-status-overdue mb-3">Payment was declined or cancelled — try again.</p>
          )}
          <p className="text-sm font-medium text-ink-muted mb-2">Payment method</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(['upi', 'card', 'cash'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMode(m)}
                className={`px-3 py-2 rounded-xl text-sm font-medium border uppercase transition-colors ${
                  paymentMode === m ? 'bg-ink text-surface border-ink' : 'border-ink/10 text-ink-muted hover:bg-surface-overlay'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint mb-1">Customer (optional — for CRM/analytics)</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Phone (10-digit)"
              className="rounded-xl border border-ink/10 px-3 py-2 text-sm"
            />
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Name (optional)"
              className="rounded-xl border border-ink/10 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={pay}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
          >
            <CreditCard size={16} /> {busy ? 'Processing…' : `Pay ₹${order.total_amount}`}
          </button>
        </div>
      )}

      {order.pos_status === 'PAID' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
          <CheckCircle2 size={32} className="mx-auto text-green-600 mb-2" />
          <p className="font-display text-lg font-semibold text-ink">Payment received</p>
          <p className="text-sm text-ink-muted mt-1">
            ₹{order.total_amount} paid via {payment?.mode ?? order.payment_method} · Table released
          </p>
          <button
            onClick={() => router.push('/pos')}
            className="mt-4 rounded-xl bg-ink text-surface px-5 py-2.5 text-sm font-medium"
          >
            Back to tables
          </button>
        </div>
      )}

      {order.pos_status === 'CANCELLED' && (
        <div className="bg-surface-overlay rounded-2xl p-5 text-center">
          <p className="text-ink-muted">This order was cancelled. Table released.</p>
          <button
            onClick={() => router.push('/pos')}
            className="mt-4 rounded-xl bg-ink text-surface px-5 py-2.5 text-sm font-medium"
          >
            Back to tables
          </button>
        </div>
      )}
    </div>
  )
}
