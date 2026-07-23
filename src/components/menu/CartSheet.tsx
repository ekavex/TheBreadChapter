'use client'
import { useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { useCartStore } from '@/lib/hooks/useCart'
import type { Cafe, Table } from '@/lib/types'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'

interface Props {
  cafe: Cafe
  table: Table
  onClose: () => void
}

export default function CartSheet({ cafe, table, onClose }: Props) {
  const { cart, updateQuantity, removeItem, subtotal, clearCart } = useCartStore()
  const [notes, setNotes] = useState('')
  const [payMethod, setPayMethod] = useState<'upi' | 'cash'>('upi')
  const [placing, setPlacing] = useState(false)
  const router = useRouter()

  if (!cart) return null

  const sub = subtotal()
  const tax = Math.round(sub * (cafe.settings.tax_percent / 100))
  const total = sub + tax

  async function placeOrder() {
    setPlacing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cafeId: cafe.id,
          tableId: table.id,
          items: cart!.items.map(i => ({
            menuItemId: i.menuItem.id,
            name: i.menuItem.name,
            price: i.menuItem.price,
            quantity: i.quantity,
            customisation: i.customisation,
          })),
          paymentMethod: payMethod,
          notes,
          subtotal: sub,
          taxAmount: tax,
          totalAmount: total,
        }),
      })
      const { data, error } = await res.json()
      if (error) throw new Error(error)

      clearCart()
      router.push(`/order/${data.id}`)
    } catch (err) {
      toast.error('Could not place order. Please try again.')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/40 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-surface-raised rounded-t-3xl animate-slide-up max-h-[85vh] overflow-auto pb-safe">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-ink/15 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink/5">
          <h2 className="font-display text-lg font-semibold">Your order</h2>
          <span className="text-sm text-ink-muted">Table {table.number}</span>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface-overlay">
            <X size={18} className="text-ink-muted" />
          </button>
        </div>

        {/* Cart items */}
        <div className="px-5 py-3 space-y-3">
          {cart.items.map(({ menuItem, quantity, customisation }) => (
            <div key={menuItem.id} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">{menuItem.name}</p>
                {customisation && (
                  <p className="text-xs text-ink-muted">{customisation}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(menuItem.id, quantity - 1)}
                  className="w-6 h-6 rounded-full border border-ink/20 flex items-center justify-center text-ink-muted hover:border-ink/40"
                >
                  −
                </button>
                <span className="text-sm font-medium w-4 text-center">{quantity}</span>
                <button
                  onClick={() => updateQuantity(menuItem.id, quantity + 1)}
                  className="w-6 h-6 rounded-full border border-ink/20 flex items-center justify-center text-ink-muted hover:border-ink/40"
                >
                  +
                </button>
              </div>
              <span className="text-sm font-semibold text-ink w-16 text-right">
                ₹{menuItem.price * quantity}
              </span>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="px-5 pb-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any special requests? (e.g. no sugar, extra spicy)"
            className="w-full text-sm text-ink placeholder:text-ink-faint bg-surface-overlay rounded-xl px-3 py-2 resize-none border border-ink/5 focus:outline-none focus:ring-1 focus:ring-brand-400"
            rows={2}
          />
        </div>

        {/* Payment method */}
        <div className="px-5 pb-3">
          <p className="text-xs text-ink-muted mb-2 font-medium uppercase tracking-wide">Pay by</p>
          <div className="flex gap-2">
            {cafe.settings.accept_upi && (
              <button
                onClick={() => setPayMethod('upi')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  payMethod === 'upi'
                    ? 'border-brand-400 bg-brand-50 text-brand-700'
                    : 'border-ink/10 text-ink-muted'
                }`}
              >
                UPI / QR
              </button>
            )}
            {cafe.settings.accept_cash && (
              <button
                onClick={() => setPayMethod('cash')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  payMethod === 'cash'
                    ? 'border-brand-400 bg-brand-50 text-brand-700'
                    : 'border-ink/10 text-ink-muted'
                }`}
              >
                Pay at counter
              </button>
            )}
          </div>
        </div>

        {/* Bill summary */}
        <div className="mx-5 mb-4 bg-surface-overlay rounded-2xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-ink-muted">
            <span>Subtotal</span><span>₹{sub}</span>
          </div>
          <div className="flex justify-between text-sm text-ink-muted">
            <span>GST ({cafe.settings.tax_percent}%)</span><span>₹{tax}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-ink pt-1.5 border-t border-ink/10">
            <span>Total</span><span>₹{total}</span>
          </div>
        </div>

        {/* CTA */}
        <div className="px-5 pb-6">
          <button
            onClick={placeOrder}
            disabled={placing}
            className="w-full bg-brand-400 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold py-4 rounded-2xl text-base transition-colors active:scale-[0.98]"
          >
            {placing ? 'Placing your order...' : `Place order · ₹${total}`}
          </button>
        </div>
      </div>
    </>
  )
}
