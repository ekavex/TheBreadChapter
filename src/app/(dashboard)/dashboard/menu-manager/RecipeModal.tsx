'use client'
import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Ingredient, MenuItem, Recipe } from '@/lib/types'
import { formatPaisa, rupeesToPaisa } from '@/lib/money'

interface Props {
  menuItem: MenuItem
  ingredients: Ingredient[]
  onClose: () => void
  onSaved: () => void
}

interface Line {
  ingredient_id: string
  quantity: number | ''
}

export default function RecipeModal({ menuItem, ingredients, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    fetch(`/api/recipes?menuItemId=${menuItem.id}`)
      .then((res) => res.json())
      .then(({ data }: { data: Recipe | null }) => {
        if (data) {
          setRecipeId(data.id)
          setLines(
            (data.ingredients ?? []).map((l) => ({ ingredient_id: l.ingredient_id, quantity: l.quantity }))
          )
        } else {
          setLines([{ ingredient_id: ingredients[0]?.id ?? '', quantity: '' }])
        }
      })
      .catch(() => toast.error('Failed to load recipe'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItem.id])

  function addLine() {
    setLines((prev) => [...prev, { ingredient_id: ingredients[0]?.id ?? '', quantity: '' }])
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  const estimatedCostPaisa = lines.reduce((sum, l) => {
    const ingredient = ingredients.find((i) => i.id === l.ingredient_id)
    if (!ingredient || l.quantity === '') return sum
    return sum + ingredient.cost_per_unit_paisa * Number(l.quantity)
  }, 0)
  const sellingPricePaisa = rupeesToPaisa(menuItem.price)
  const profitPaisa = sellingPricePaisa - estimatedCostPaisa

  async function handleSave() {
    const validLines = lines.filter((l) => l.ingredient_id && l.quantity !== '' && Number(l.quantity) > 0)
    if (validLines.length === 0) return toast.error('Add at least one ingredient line')

    setSaving(true)
    try {
      const payload = { lines: validLines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity) })) }
      const res = recipeId
        ? await fetch(`/api/recipes/${recipeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/recipes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ menu_item_id: menuItem.id, ...payload }),
          })

      const { error } = await res.json()
      if (error) throw new Error(error)

      toast.success('Recipe saved')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRecipe() {
    if (!recipeId) return
    if (!confirm('Remove this recipe? Cost tracking for this item will reset to ₹0.')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success('Recipe removed')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-semibold text-ink">Recipe · {menuItem.name}</h2>
          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Selling price ₹{menuItem.price} — recipe cost auto-recalculates when ingredient costs change.
        </p>

        {loading ? (
          <p className="text-sm text-ink-faint py-6 text-center">Loading…</p>
        ) : (
          <>
            <div className="space-y-2 mb-3">
              {lines.map((line, i) => {
                const ingredient = ingredients.find((ing) => ing.id === line.ingredient_id)
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={line.ingredient_id}
                      onChange={(e) => updateLine(i, { ingredient_id: e.target.value })}
                      className="flex-1 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    >
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>{ing.name}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value === '' ? '' : Number(e.target.value) })}
                      placeholder="qty"
                      className="w-24 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    />
                    <span className="text-xs text-ink-faint w-10">{ingredient?.unit}</span>
                    <button
                      onClick={() => removeLine(i)}
                      className="p-2 text-ink-faint hover:text-red-600"
                      title="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              onClick={addLine}
              className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-5"
            >
              <Plus size={14} /> Add ingredient
            </button>

            <div className="bg-surface-overlay rounded-xl p-4 mb-5 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-muted">Recipe cost (estimated)</span>
                <span className="font-medium text-ink">{formatPaisa(estimatedCostPaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Selling price</span>
                <span className="font-medium text-ink">{formatPaisa(sellingPricePaisa)}</span>
              </div>
              <div className="flex justify-between border-t border-ink/10 pt-1 mt-1">
                <span className="text-ink-muted">Profit</span>
                <span className={`font-semibold ${profitPaisa < 0 ? 'text-status-overdue' : 'text-ink'}`}>
                  {formatPaisa(profitPaisa)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              {recipeId && (
                <button
                  onClick={handleDeleteRecipe}
                  disabled={saving}
                  className="rounded-xl border border-ink/10 px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  Remove recipe
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl bg-ink text-surface py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save recipe'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
