'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Trash2, Send, Receipt, CreditCard, XCircle, CheckCircle2, Users } from 'lucide-react'
import type { Order, MenuCategory, MenuItem, Payment, PosStatus, Table } from '@/lib/types'
import { printKot } from '@/lib/printer/kotPrint'
import { printBill } from '@/lib/printer/billPrint'

interface Props {
  initialOrder: Order | null
  tableId?: string       // present when initialOrder is null (new order)
  initialTable?: Table   // present when initialOrder is null
  categories: MenuCategory[]
}

const STATUS_LABELS: Record<PosStatus, string> = {
  OPEN: 'Open',
  KOT_SENT: 'KOT Sent',
  BILLED: 'Billed',
  AWAITING_PAYMENT: 'Awaiting Payment',
  PAID: 'Paid',
  PAYMENT_FAILED: 'Payment Failed',
  REQUIRES_VERIFICATION: 'Needs Verification',
  CANCELLED: 'Cancelled',
}

type PaymentState = 'paid' | 'failed' | 'cancelled' | 'pending' | 'requires_verification'

interface PaymentResponse {
  order: Order
  payment: Payment
  paymentState: PaymentState
  message: string | null
}

// Automatic follow-up while a transaction is open on the terminal.
const PAYMENT_TRACK_GAP_MS = 2_000
const PAYMENT_TRACK_TIMEOUT_MS = 6 * 60_000

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

export default function PosOrderClient({ initialOrder, tableId, initialTable, categories }: Props) {
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(initialOrder)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? '')
  const [paymentMode, setPaymentMode] = useState<'upi' | 'card' | 'cash'>('upi')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [busy, setBusy] = useState(false)
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null)
  // True while the terminal still has the transaction open — the screen tracks
  // it automatically so the cashier never has to poll by hand.
  const [autoTracking, setAutoTracking] = useState(false)
  const trackingRef = useRef(false)

  // Table info — use joined order.table once order exists, fall back to initialTable prop
  const tableNumber = order?.table?.number ?? initialTable?.number
  const sectionName = (order?.table as (Table & { section?: { name: string } }) | undefined)?.section?.name
    ?? (initialTable as (Table & { section?: { name: string } }) | undefined)?.section?.name

  async function ensureOrder(): Promise<string> {
    if (order) return order.id
    const created = await api<Order>('/api/pos/orders', 'POST', { tableId })
    setOrder(created)
    // Update URL to the real order page so refreshing works correctly
    router.replace(`/pos/order/${created.id}`)
    return created.id
  }

  async function refreshOrder() {
    if (!order) return
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
      const orderId = await ensureOrder()
      const updated = await api<Order>(`/api/pos/orders/${orderId}/items`, 'POST', { menu_item_id: item.id, quantity: 1 })
      setOrder(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add item')
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(orderItemId: string) {
    if (!order) return
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
    if (!order || (order.items ?? []).length === 0) return toast.error('Add at least one item first')
    setBusy(true)
    try {
      const res = await fetch(`/api/pos/orders/${order.id}/kot`, { method: 'POST' })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setOrder(json.data as Order)
      printKot(json.data as Order)
      if (json.printerWarning) {
        toast('KOT sent — thermal printer offline, printing from browser instead', { icon: '⚠️' })
      } else {
        toast.success('Sent to kitchen — KOT printed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send KOT')
    } finally {
      setBusy(false)
    }
  }

  async function generateBill() {
    if (!order) return
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

  // One request shape for both "take payment" and "verify what happened".
  // The server decides which it is from the order state, so the client can
  // never accidentally start a second charge.
  const submitPayment = useCallback(
    async (opts: { announce: boolean }): Promise<PaymentState | null> => {
      if (!order) return null
      try {
        const result = await api<PaymentResponse>(`/api/pos/orders/${order.id}/pay`, 'POST', {
          mode: paymentMode,
          customer_phone: customerPhone.trim() || null,
          customer_name: customerName.trim() || null,
        })
        setOrder(result.order)
        setPayment(result.payment)
        setPaymentNotice(result.message ?? null)

        // A timeout is NOT a failure — never say "declined" unless Pine Labs did.
        if (opts.announce || result.paymentState !== 'pending') {
          switch (result.paymentState) {
            case 'paid':
              toast.success('Payment approved')
              break
            case 'pending':
              toast('Waiting for the customer to pay on the terminal…', { icon: '⏳' })
              break
            case 'requires_verification':
              toast.error(result.message ?? 'Payment needs verification — do not retry yet', { duration: 8000 })
              break
            case 'cancelled':
              toast('Payment cancelled on the terminal', { icon: '🚫' })
              break
            default:
              toast.error('Payment declined by the terminal — you can retry')
          }
        }
        return result.paymentState
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Payment failed')
        return null
      }
    },
    [order, paymentMode, customerPhone, customerName]
  )

  async function pay() {
    setBusy(true)
    try {
      await submitPayment({ announce: true })
    } finally {
      setBusy(false)
    }
  }

  // Keeps verifying an open transaction until the terminal settles it. Each
  // request already waits server-side, so this is a slow, cheap loop — and it
  // is verification only, never a new charge.
  useEffect(() => {
    if (order?.pos_status !== 'AWAITING_PAYMENT') {
      trackingRef.current = false
      setAutoTracking(false)
      return
    }
    if (trackingRef.current) return

    trackingRef.current = true
    setAutoTracking(true)
    let cancelled = false

    const track = async () => {
      const deadline = Date.now() + PAYMENT_TRACK_TIMEOUT_MS
      while (!cancelled && Date.now() < deadline) {
        const state = await submitPayment({ announce: false })
        if (cancelled || state !== 'pending') break
        await new Promise((r) => setTimeout(r, PAYMENT_TRACK_GAP_MS))
      }
      if (!cancelled) {
        trackingRef.current = false
        setAutoTracking(false)
      }
    }

    void track()
    return () => {
      cancelled = true
      trackingRef.current = false
      setAutoTracking(false)
    }
  }, [order?.pos_status, submitPayment])

  async function markOccupied() {
    setBusy(true)
    try {
      const orderId = await ensureOrder()
      const updated = await api<Order>(`/api/pos/orders/${orderId}/occupy`, 'POST')
      setOrder(updated)
      toast.success('Table marked as occupied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark occupied')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder() {
    if (!order) {
      // No DB order created yet — just go back
      router.push('/pos')
      return
    }
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

  const items = order?.items ?? []
  const runningSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0)
  const posStatus = order?.pos_status ?? 'OPEN'
  const isOpen = posStatus === 'OPEN'
  // AWAITING_PAYMENT stays cancellable — the server force-cancels the open
  // transaction and refuses if the money was actually taken. An order already
  // flagged for verification must be resolved by a human, not cancelled away.
  const canCancel = !['PAID', 'CANCELLED', 'REQUIRES_VERIFICATION'].includes(posStatus)
  const tableIsFree = !order || order.table?.status === 'free'
  const activeCategoryItems = categories.find((c) => c.id === activeCategory)?.items ?? []

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.push('/pos')} className="text-sm text-ink-muted hover:text-ink mb-1">
            ← Back to tables
          </button>
          <h1 className="font-display text-2xl font-bold text-ink">
            Table {tableNumber} · {sectionName}
          </h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {order ? `Order ${order.order_number}` : 'New order'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {order && (
            <span className="text-xs font-medium uppercase tracking-wide bg-surface-overlay text-ink-muted px-3 py-1.5 rounded-full">
              {STATUS_LABELS[posStatus]}
            </span>
          )}
          {canCancel && (
            <button
              onClick={cancelOrder}
              disabled={busy}
              title={order ? 'Cancel order' : 'Go back'}
              className="p-2 rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              <XCircle size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Menu browser — shown while order is open (or not yet created) */}
      {isOpen && (
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
              {isOpen && (
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
              {['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(posStatus) ? 'Subtotal' : 'Running total'}
            </span>
            <span className="font-semibold text-ink">
              ₹{['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(posStatus) ? order?.subtotal : runningSubtotal}
            </span>
          </div>
        )}
        {['BILLED', 'AWAITING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(posStatus) && order && (
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

      {/* Action area */}
      {isOpen && (
        <div className="space-y-2">
          {tableIsFree && (
            <button
              onClick={markOccupied}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-700 py-3 font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              <Users size={16} /> Mark as Occupied
            </button>
          )}
          <button
            onClick={sendToKitchen}
            disabled={busy || items.length === 0}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
          >
            <Send size={16} /> Send to Kitchen
          </button>
        </div>
      )}

      {posStatus === 'KOT_SENT' && (
        <button
          onClick={generateBill}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
        >
          <Receipt size={16} /> Generate Bill
        </button>
      )}

      {order && ['BILLED', 'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAID'].includes(posStatus) && (
        <button
          onClick={() => printBill(order, { paid: posStatus === 'PAID', mode: payment?.mode ?? order.payment_method })}
          className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-ink/15 text-ink py-2.5 text-sm font-medium"
        >
          <Receipt size={15} /> Print customer bill
        </button>
      )}

      {(posStatus === 'BILLED' || posStatus === 'PAYMENT_FAILED') && (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
          {posStatus === 'PAYMENT_FAILED' && (
            <p className="text-sm text-status-overdue mb-3">
              {paymentNotice ?? 'The terminal declined or cancelled this payment — you can retry.'}
            </p>
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
            <CreditCard size={16} /> {busy ? 'Processing…' : `Pay ₹${order?.total_amount}`}
          </button>
        </div>
      )}

      {posStatus === 'AWAITING_PAYMENT' && (
        <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
            <p className="font-display font-semibold text-ink">
              {autoTracking ? 'Waiting for the terminal…' : 'Payment in progress'}
            </p>
          </div>
          <p className="text-sm text-ink-muted mb-3">
            {paymentNotice ??
              'Ask the customer to complete the payment on the terminal. This screen updates itself — you never need to charge again.'}
          </p>
          <button
            onClick={pay}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-ink/15 text-ink py-3 font-medium disabled:opacity-50"
          >
            <CreditCard size={16} /> {busy ? 'Checking…' : 'Check now'}
          </button>
        </div>
      )}

      {posStatus === 'REQUIRES_VERIFICATION' && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5">
          <p className="font-display font-semibold text-amber-900 mb-1">Payment needs verification</p>
          <p className="text-sm text-amber-900/80 mb-3">
            {paymentNotice ??
              'We could not confirm the outcome of this payment with Pine Labs. Check the terminal and the Pine Labs report before charging again — the customer may already have paid.'}
          </p>
          <button
            onClick={pay}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-surface py-3 font-medium disabled:opacity-50"
          >
            <CreditCard size={16} /> {busy ? 'Checking…' : 'Re-check with Pine Labs'}
          </button>
        </div>
      )}

      {posStatus === 'PAID' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
          <CheckCircle2 size={32} className="mx-auto text-green-600 mb-2" />
          <p className="font-display text-lg font-semibold text-ink">Payment received</p>
          <p className="text-sm text-ink-muted mt-1">
            ₹{order?.total_amount} paid via {payment?.mode ?? order?.payment_method} · Table released
          </p>
          <button
            onClick={() => router.push('/pos')}
            className="mt-4 rounded-xl bg-ink text-surface px-5 py-2.5 text-sm font-medium"
          >
            Back to tables
          </button>
        </div>
      )}

      {posStatus === 'CANCELLED' && (
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
