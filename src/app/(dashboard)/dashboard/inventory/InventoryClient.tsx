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

function DeleteModal({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 rounded-xl bg-red-50 shrink-0"><AlertTriangle size={18} className="text-red-600" /></div>
            <div>
              <h3 className="font-semibold text-ink text-base">Delete ingredient?</h3>
              <p className="text-ink-muted text-sm mt-1">Delete &quot;{name}&quot;? This cannot be undone.</p>
            </div>
          </div>
        </div>
        <div className="flex border-t border-ink/8">
          <button onClick={onCancel} className="flex-1 py-3.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay transition-colors">Cancel</button>
          <div className="w-px bg-ink/8" />
          <button onClick={onConfirm} className="flex-1 py-3.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors">Delete</button>
        </div>
      </div>
    </div>
  )
}

export default function InventoryClient({ ingredients }: Props) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [stockFor, setStockFor] = useState<Ingredient | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Ingredient | null>(null)

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
    setDeleteTarget(ingredient)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(deleteTarget.id)
    setDeleteTarget(null)
    try {
      const res = await fetch(`/api/ingredients/${deleteTarget.id}`, { method: 'DELETE' })
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
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
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

      {/* ── Desktop table (md+) ── */}
      <div className="hidden md:block bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
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
                        <button onClick={() => setStockFor(i)} title="Update stock" className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink">
                          <PackagePlus size={16} />
                        </button>
                        <button onClick={() => setEditing(i)} title="Edit" className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(i)} disabled={deleting === i.id} title="Delete" className="p-2 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
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

      {/* ── Mobile cards (< md) ── */}
      <div className="md:hidden space-y-3">
        {ingredients.length === 0 && (
          <div className="bg-surface-raised rounded-2xl border border-ink/5 p-8 text-center">
            <p className="text-ink-faint text-sm">No ingredients yet — add your first one.</p>
          </div>
        )}
        {ingredients.map((i) => {
          const isLow = i.current_stock <= i.low_stock_threshold
          const days = daysToExpiry(i.expiry_date)
          const isExpiring = days !== null && days <= 3
          return (
            <div key={i.id} className={`bg-surface-raised rounded-2xl border p-4 ${isLow ? 'border-red-200 bg-red-50/30' : 'border-ink/5'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-ink">{i.name}</p>
                  {i.is_perishable && <p className="text-xs text-ink-faint">Perishable</p>}
                </div>
                {isLow && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-status-overdue bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={11} /> Low stock
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
                <div>
                  <p className="text-xs text-ink-faint mb-0.5">Stock</p>
                  <p className={`font-medium ${isLow ? 'text-status-overdue' : 'text-ink'}`}>
                    {i.current_stock} {i.unit}
                    <span className="text-ink-faint font-normal text-xs ml-1">(min {i.low_stock_threshold})</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint mb-0.5">Cost/unit</p>
                  <p className="text-ink">{formatPaisa(i.cost_per_unit_paisa)}</p>
                </div>
                {i.expiry_date && (
                  <div>
                    <p className="text-xs text-ink-faint mb-0.5">Expiry</p>
                    <p className={isExpiring ? 'text-amber-600 font-medium' : 'text-ink-muted'}>
                      {isExpiring && <Clock size={11} className="inline mr-0.5" />}
                      {i.expiry_date}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-ink/5">
                <button
                  onClick={() => setStockFor(i)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors border border-ink/8"
                >
                  <PackagePlus size={13} /> Update stock
                </button>
                <button
                  onClick={() => setEditing(i)}
                  className="p-2.5 rounded-xl text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors border border-ink/8"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(i)}
                  disabled={deleting === i.id}
                  className="p-2.5 rounded-xl text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors border border-ink/8"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {addOpen && <IngredientModal onClose={() => setAddOpen(false)} onSaved={refresh} />}
      {editing && <IngredientModal ingredient={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {stockFor && <StockUpdateModal ingredient={stockFor} onClose={() => setStockFor(null)} onSaved={refresh} />}
      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
