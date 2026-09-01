'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Ingredient, StockTxnType } from '@/lib/types'

interface Props {
  ingredient: Ingredient
  onClose: () => void
  onSaved: () => void
}

const TYPE_LABELS: Record<StockTxnType, string> = {
  purchase: 'Purchase entry',
  manual_adjustment: 'Manual adjustment',
  expired_removal: 'Expired stock removal',
  sale_deduction: 'Sale deduction', // not selectable here - automatic, order-driven
}

export default function StockUpdateModal({ ingredient, onClose, onSaved }: Props) {
  const [type, setType] = useState<StockTxnType>('purchase')
  const [quantity, setQuantity] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (quantity === '' || Number(quantity) === 0) return toast.error('Enter a non-zero quantity')
    setSaving(true)
    try {
      const res = await fetch(`/api/ingredients/${ingredient.id}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          quantity: Number(quantity),
          note: note.trim() || null,
          expiry_date: type === 'purchase' && ingredient.is_perishable && expiryDate ? expiryDate : null,
        }),
      })
      const { error } = await res.json()
      if (error) throw new Error(error)

      toast.success('Stock updated')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-md p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-semibold text-ink">Update Stock</h2>
          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          {ingredient.name} · current: {ingredient.current_stock} {ingredient.unit}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['purchase', 'manual_adjustment', 'expired_removal'] as StockTxnType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-2 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    type === t
                      ? 'bg-ink text-surface border-ink'
                      : 'border-ink/10 text-ink-muted hover:bg-surface-overlay'
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">
              Quantity ({ingredient.unit})
              {type === 'manual_adjustment' && ' - use a negative number to subtract'}
            </label>
            <input
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              placeholder={type === 'manual_adjustment' ? 'e.g. -5' : 'e.g. 50'}
              required
            />
          </div>

          {type === 'purchase' && ingredient.is_perishable && (
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">
                Expiry date for this batch (optional)
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              placeholder="e.g. Supplier invoice #123"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </form>
      </div>
    </div>
  )
}
