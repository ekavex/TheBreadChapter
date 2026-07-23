'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, PackagePlus, AlertTriangle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Ingredient } from '@/lib/types'
import { formatPaisa } from '@/lib/money'
import IngredientModal from './IngredientModal'
import StockUpdateModal from './StockUpdateModal'

interface Props { ingredients: Ingredient[] }

function daysToExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function InventoryClient({ ingredients }: Props) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [stockFor, setStockFor] = useState<Ingredient | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const lowStockCount = ingredients.filter((i) => i.current_stock <= i.low_stock_threshold).length
  const expiringCount = ingredients.filter((i) => {
    const d = daysToExpiry(i.expiry_date)
    return d !== null && d <= 3
  }).length

  function refresh() {
    setAddOpen(false)
    setEditing(null)
    setStockFor(null)
    router.refresh()
  }

  async function handleDelete(ingredient: Ingredient) {
    if (!confirm(`Delete "${ingredient.name}"? This cannot be undone.`)) return
    setDeleting(ingredient.id)
    try {
      const res = await fetch(`/api/ingredients/${ingredient.id}`, { method: 'DELETE' })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success('Ingredient deleted')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Inventory</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {ingredients.length} ingredients
            {lowStockCount > 0 && <span className="text-status-overdue"> · {lowStockCount} low stock</span>}
            {expiringCount > 0 && <span className="text-amber-600"> · {expiringCount} expiring soon</span>}
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium shrink-0"
        >
          <Plus size={16} /> Add Ingredient
        </button>
      </div>

      <div className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/5 bg-surface-overlay text-left text-ink-faint">
                <th className="px-5 py-3 font-medium">Ingredient</th>
                <th className="px-5 py-3 font-medium">Stock</th>
                <th className="px-5 py-3 font-medium">Cost/unit</th>
                <th className="px-5 py-3 font-medium">Expiry</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {ingredients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-ink-faint">
                    No ingredients yet — add your first one.
                  </td>
                </tr>
              )}
              {ingredients.map((i) => {
                const isLow = i.current_stock <= i.low_stock_threshold
                const days = daysToExpiry(i.expiry_date)
                const isExpiring = days !== null && days <= 3
                return (
                  <tr key={i.id} className={isLow ? 'bg-red-50/40' : undefined}>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-ink">{i.name}</p>
                      {i.is_perishable && <p className="text-xs text-ink-faint">Perishable</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={isLow ? 'text-status-overdue font-semibold' : 'text-ink'}>
                        {i.current_stock} {i.unit}
                      </span>
                      {isLow && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-status-overdue">
                          <AlertTriangle size={12} /> Low
                        </span>
                      )}
                      <p className="text-xs text-ink-faint mt-0.5">threshold: {i.low_stock_threshold}</p>
                    </td>
                    <td className="px-5 py-3.5 text-ink-muted">{formatPaisa(i.cost_per_unit_paisa)}</td>
                    <td className="px-5 py-3.5">
                      {i.expiry_date ? (
                        <span className={isExpiring ? 'inline-flex items-center gap-1 text-amber-600 font-medium' : 'text-ink-muted'}>
                          {isExpiring && <Clock size={12} />}
                          {i.expiry_date}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setStockFor(i)}
                          title="Update stock"
                          className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink"
                        >
                          <PackagePlus size={16} />
                        </button>
                        <button
                          onClick={() => setEditing(i)}
                          title="Edit"
                          className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(i)}
                          disabled={deleting === i.id}
                          title="Delete"
                          className="p-2 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && <IngredientModal onClose={() => setAddOpen(false)} onSaved={refresh} />}
      {editing && <IngredientModal ingredient={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {stockFor && <StockUpdateModal ingredient={stockFor} onClose={() => setStockFor(null)} onSaved={refresh} />}
    </div>
  )
}
