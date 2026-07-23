'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Ingredient } from '@/lib/types'
import { rupeesToPaisa, paisaToRupees } from '@/lib/money'

interface Props {
  ingredient?: Ingredient | null
  onClose: () => void
  onSaved: () => void
}

const UNITS = ['gm', 'kg', 'ml', 'liters', 'pieces']

export default function IngredientModal({ ingredient, onClose, onSaved }: Props) {
  const isEdit = !!ingredient
  const [name, setName] = useState(ingredient?.name ?? '')
  const [unit, setUnit] = useState(ingredient?.unit ?? 'gm')
  const [currentStock, setCurrentStock] = useState(ingredient?.current_stock ?? 0)
  const [lowStockThreshold, setLowStockThreshold] = useState(ingredient?.low_stock_threshold ?? 0)
  const [costRupees, setCostRupees] = useState(
    ingredient ? paisaToRupees(ingredient.cost_per_unit_paisa) : 0
  )
  const [isPerishable, setIsPerishable] = useState(ingredient?.is_perishable ?? false)
  const [expiryDate, setExpiryDate] = useState(ingredient?.expiry_date ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        unit,
        low_stock_threshold: Number(lowStockThreshold),
        cost_per_unit_paisa: rupeesToPaisa(Number(costRupees)),
        is_perishable: isPerishable,
        expiry_date: isPerishable && expiryDate ? expiryDate : null,
        ...(isEdit ? {} : { current_stock: Number(currentStock) }),
      }

      const res = await fetch(isEdit ? `/api/ingredients/${ingredient!.id}` : '/api/ingredients', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { error } = await res.json()
      if (error) throw new Error(error)

      toast.success(isEdit ? 'Ingredient updated' : 'Ingredient added')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-md p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-ink">
            {isEdit ? 'Edit Ingredient' : 'Add Ingredient'}
          </h2>
          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              placeholder="e.g. Milk"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            {!isEdit && (
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1">Starting stock</label>
                <input
                  type="number"
                  step="any"
                  value={currentStock}
                  onChange={(e) => setCurrentStock(Number(e.target.value))}
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Low stock threshold</label>
              <input
                type="number"
                step="any"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(Number(e.target.value))}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Cost per {unit} (₹)</label>
              <input
                type="number"
                step="0.01"
                value={costRupees}
                onChange={(e) => setCostRupees(Number(e.target.value))}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={isPerishable}
              onChange={(e) => setIsPerishable(e.target.checked)}
              className="rounded border-ink/20"
            />
            Perishable (track expiry)
          </label>

          {isPerishable && (
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Nearest expiry date</label>
              <input
                type="date"
                value={expiryDate ?? ''}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add ingredient'}
          </button>
        </form>
      </div>
    </div>
  )
}
