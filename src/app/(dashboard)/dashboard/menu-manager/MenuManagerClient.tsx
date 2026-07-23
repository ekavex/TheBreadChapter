'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ChefHat, Plus, Pencil, Trash2 } from 'lucide-react'
import type { MenuCategory, MenuItem, Ingredient } from '@/lib/types'
import { formatPaisa, rupeesToPaisa } from '@/lib/money'
import toast from 'react-hot-toast'
import RecipeModal from './RecipeModal'
import MenuCrudGateModal from './MenuCrudGateModal'
import ItemModal from './ItemModal'
import CategoryModal from './CategoryModal'

interface Props {
  categories: MenuCategory[]
  ingredients: Ingredient[]
}

type Gate =
  | { kind: 'add-category' }
  | { kind: 'edit-category'; category: MenuCategory }
  | { kind: 'delete-category'; category: MenuCategory }
  | { kind: 'add-item'; category: MenuCategory }
  | { kind: 'edit-item'; item: MenuItem }
  | { kind: 'delete-item'; item: MenuItem }

const GATE_LABELS: Record<Gate['kind'], string> = {
  'add-category': 'Add Menu Category',
  'edit-category': 'Edit Menu Category',
  'delete-category': 'Delete Menu Category',
  'add-item': 'Add Menu Item',
  'edit-item': 'Edit Menu Item',
  'delete-item': 'Delete Menu Item',
}

export default function MenuManagerClient({ categories, ingredients }: Props) {
  const router = useRouter()
  const [toggling, setToggling] = useState<string | null>(null)
  const [recipeFor, setRecipeFor] = useState<MenuItem | null>(null)
  const [pendingGate, setPendingGate] = useState<Gate | null>(null)
  const [verifiedGate, setVerifiedGate] = useState<{ token: string; gate: Gate } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const totalItems = categories.reduce((s, c) => s + (c.items?.length ?? 0), 0)
  const unavailable = categories.reduce(
    (s, c) => s + (c.items ?? []).filter(i => !i.is_available).length, 0
  )

  async function toggleAvailability(item: MenuItem) {
    setToggling(item.id)
    try {
      const res = await fetch('/api/menu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, is_available: !item.is_available }),
      })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success(`${item.name} marked ${item.is_available ? 'unavailable' : 'available'}`)
      router.refresh()
    } catch {
      toast.error('Update failed')
    } finally {
      setToggling(null)
    }
  }

  function refresh() {
    setVerifiedGate(null)
    router.refresh()
  }

  async function handleGateVerified(token: string) {
    const gate = pendingGate!
    setPendingGate(null)

    if (gate.kind === 'delete-category') {
      if (!confirm(`Delete category "${gate.category.name}"?`)) return
      setDeleting(true)
      try {
        const res = await fetch(`/api/menu/categories/${gate.category.id}`, {
          method: 'DELETE',
          headers: { 'x-menu-crud-token': token },
        })
        const { error } = await res.json()
        if (error) throw new Error(error)
        toast.success('Category deleted')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setDeleting(false)
      }
      return
    }

    if (gate.kind === 'delete-item') {
      if (!confirm(`Delete "${gate.item.name}"?`)) return
      setDeleting(true)
      try {
        const res = await fetch(`/api/menu/items/${gate.item.id}`, {
          method: 'DELETE',
          headers: { 'x-menu-crud-token': token },
        })
        const { error } = await res.json()
        if (error) throw new Error(error)
        toast.success('Item deleted')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setDeleting(false)
      }
      return
    }

    setVerifiedGate({ token, gate })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Menu Manager</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {totalItems} items · {unavailable} unavailable
          </p>
        </div>
        <button
          onClick={() => setPendingGate({ kind: 'add-category' })}
          className="flex items-center gap-1.5 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium shrink-0"
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      <div className="space-y-6">
        {categories.map(cat => (
          <div key={cat.id} className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
            {/* Category header */}
            <div className="px-5 py-3.5 border-b border-ink/5 bg-surface-overlay flex items-center justify-between">
              <h2 className="font-display font-semibold text-ink">{cat.name}</h2>
              <div className="flex items-center gap-1">
                <span className="text-xs text-ink-faint mr-2">
                  {(cat.items ?? []).filter(i => i.is_available).length} / {(cat.items ?? []).length} available
                </span>
                <button
                  onClick={() => setPendingGate({ kind: 'add-item', category: cat })}
                  title="Add item"
                  className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => setPendingGate({ kind: 'edit-category', category: cat })}
                  title="Edit category"
                  className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setPendingGate({ kind: 'delete-category', category: cat })}
                  disabled={deleting}
                  title="Delete category"
                  className="p-1.5 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Items */}
            <div className="divide-y divide-ink/5">
              {(cat.items ?? []).length === 0 && (
                <p className="px-5 py-4 text-sm text-ink-faint">No items in this category yet.</p>
              )}
              {(cat.items ?? [])
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(item => {
                  const sellingPricePaisa = rupeesToPaisa(item.price)
                  const hasRecipe = item.cost_price_paisa > 0
                  const profitPaisa = sellingPricePaisa - item.cost_price_paisa
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-4 px-5 py-3.5 transition-opacity ${
                        !item.is_available ? 'opacity-50' : ''
                      }`}
                    >
                      {/* Veg dot */}
                      <span
                        className="w-3 h-3 rounded-sm border-2 flex-shrink-0"
                        style={{ borderColor: item.is_veg ? '#22C55E' : '#EF4444' }}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink leading-tight">{item.name}</p>
                          <span className="text-[10px] uppercase tracking-wide text-ink-faint bg-surface-overlay px-1.5 py-0.5 rounded">
                            {item.category}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-xs text-ink-faint mt-0.5 truncate">{item.description}</p>
                        )}
                        <p className="text-xs mt-1">
                          {hasRecipe ? (
                            <>
                              <span className="text-ink-muted">Cost {formatPaisa(item.cost_price_paisa)}</span>
                              <span className={`ml-2 font-medium ${profitPaisa < 0 ? 'text-status-overdue' : 'text-green-600'}`}>
                                Profit {formatPaisa(profitPaisa)}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-faint">No recipe set</span>
                          )}
                        </p>
                      </div>

                      <span className="text-sm font-semibold text-ink shrink-0">₹{item.price}</span>

                      <button
                        onClick={() => setRecipeFor(item)}
                        title="Recipe & costing"
                        className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink"
                      >
                        <ChefHat size={16} />
                      </button>

                      <button
                        onClick={() => setPendingGate({ kind: 'edit-item', item })}
                        title="Edit item"
                        className="p-2 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => setPendingGate({ kind: 'delete-item', item })}
                        disabled={deleting}
                        title="Delete item"
                        className="p-2 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>

                      <button
                        onClick={() => toggleAvailability(item)}
                        disabled={toggling === item.id}
                        title={item.is_available ? 'Mark unavailable' : 'Mark available'}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
                          item.is_available
                            ? 'hover:bg-red-50 text-ink-muted hover:text-red-600'
                            : 'hover:bg-green-50 text-ink-faint hover:text-green-600'
                        }`}
                      >
                        {item.is_available
                          ? <Eye size={16} />
                          : <EyeOff size={16} />
                        }
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>

      {recipeFor && (
        <RecipeModal
          menuItem={recipeFor}
          ingredients={ingredients}
          onClose={() => setRecipeFor(null)}
          onSaved={() => {
            setRecipeFor(null)
            router.refresh()
          }}
        />
      )}

      {pendingGate && (
        <MenuCrudGateModal
          actionLabel={GATE_LABELS[pendingGate.kind]}
          onVerified={handleGateVerified}
          onCancel={() => setPendingGate(null)}
        />
      )}

      {verifiedGate?.gate.kind === 'add-category' && (
        <CategoryModal token={verifiedGate.token} onClose={() => setVerifiedGate(null)} onSaved={refresh} />
      )}
      {verifiedGate?.gate.kind === 'edit-category' && (
        <CategoryModal
          category={verifiedGate.gate.category}
          token={verifiedGate.token}
          onClose={() => setVerifiedGate(null)}
          onSaved={refresh}
        />
      )}
      {verifiedGate?.gate.kind === 'add-item' && (
        <ItemModal
          categories={categories}
          defaultCategoryId={verifiedGate.gate.category.id}
          token={verifiedGate.token}
          onClose={() => setVerifiedGate(null)}
          onSaved={refresh}
        />
      )}
      {verifiedGate?.gate.kind === 'edit-item' && (
        <ItemModal
          item={verifiedGate.gate.item}
          categories={categories}
          token={verifiedGate.token}
          onClose={() => setVerifiedGate(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
