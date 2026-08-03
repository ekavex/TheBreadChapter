'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChefHat, Plus, Pencil, Trash2, Eye, EyeOff, UtensilsCrossed, Coffee } from 'lucide-react'
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
  'add-category':    'Add Menu Category',
  'edit-category':   'Edit Menu Category',
  'delete-category': 'Delete Menu Category',
  'add-item':        'Add Menu Item',
  'edit-item':       'Edit Menu Item',
  'delete-item':     'Delete Menu Item',
}

function ItemCard({
  item,
  toggling,
  deleting,
  onToggle,
  onRecipe,
  onEdit,
  onDelete,
}: {
  item: MenuItem
  toggling: boolean
  deleting: boolean
  onToggle: () => void
  onRecipe: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const sellingPricePaisa = rupeesToPaisa(item.price)
  const hasRecipe = item.cost_price_paisa > 0
  const profitPaisa = sellingPricePaisa - item.cost_price_paisa
  const profitPct = hasRecipe && sellingPricePaisa > 0
    ? Math.round((profitPaisa / sellingPricePaisa) * 100)
    : null

  return (
    <div className={`bg-white rounded-2xl border flex flex-col transition-all ${
      item.is_available ? 'border-ink/8 shadow-sm' : 'border-ink/5 opacity-60'
    }`}>
      {/* Card top: veg dot + category + availability */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          {/* Veg / non-veg indicator */}
          <span className={`w-4 h-4 rounded-sm border-2 flex-shrink-0 ${
            item.is_veg ? 'border-green-500' : 'border-red-500'
          }`}>
            <span className={`block w-2 h-2 rounded-full m-0.5 ${
              item.is_veg ? 'bg-green-500' : 'bg-red-500'
            }`} />
          </span>
          {/* Food / beverage badge */}
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            item.category === 'beverage'
              ? 'bg-sky-50 text-sky-600'
              : 'bg-amber-50 text-amber-600'
          }`}>
            {item.category === 'beverage' ? <Coffee size={9} /> : <UtensilsCrossed size={9} />}
            {item.category}
          </span>
        </div>

        {/* Availability toggle */}
        <button
          onClick={onToggle}
          disabled={toggling}
          title={item.is_available ? 'Mark unavailable' : 'Mark available'}
          className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 ${
            item.is_available
              ? 'bg-emerald-50 text-emerald-700 hover:bg-red-50 hover:text-red-600'
              : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
          }`}
        >
          {item.is_available
            ? <span className="flex items-center gap-1"><Eye size={11} /> On</span>
            : <span className="flex items-center gap-1"><EyeOff size={11} /> Off</span>
          }
        </button>
      </div>

      {/* Item name + description */}
      <div className="px-4 flex-1">
        <h3 className="font-display font-semibold text-ink text-base leading-snug">{item.name}</h3>
        {item.description && (
          <p className="text-xs text-ink-faint mt-1 line-clamp-2 leading-relaxed">{item.description}</p>
        )}
      </div>

      {/* Price section */}
      <div className="px-4 pt-3 pb-3 mt-2 border-t border-ink/5">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-2xl font-bold text-ink">₹{item.price}</span>
          {profitPct !== null && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              profitPct >= 50 ? 'bg-green-50 text-green-700' :
              profitPct >= 20 ? 'bg-amber-50 text-amber-700' :
              'bg-red-50 text-red-600'
            }`}>
              {profitPct}% margin
            </span>
          )}
        </div>

        {/* Cost & profit row */}
        <div className="flex items-center gap-3 mt-1.5 text-xs">
          {hasRecipe ? (
            <>
              <span className="text-ink-faint">Cost {formatPaisa(item.cost_price_paisa)}</span>
              <span className={`font-medium ${profitPaisa < 0 ? 'text-red-500' : 'text-green-600'}`}>
                {profitPaisa >= 0 ? '+' : ''}{formatPaisa(profitPaisa)} profit
              </span>
            </>
          ) : (
            <span className="text-ink-faint italic">No recipe · cost unknown</span>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 pb-3 pt-1 border-t border-ink/5">
        <button
          onClick={onRecipe}
          title="Recipe & costing"
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors"
        >
          <ChefHat size={13} /> Recipe
        </button>
        <div className="w-px h-4 bg-ink/8" />
        <button
          onClick={onEdit}
          title="Edit item"
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors"
        >
          <Pencil size={13} /> Edit
        </button>
        <div className="w-px h-4 bg-ink/8" />
        <button
          onClick={onDelete}
          disabled={deleting}
          title="Delete item"
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  )
}

export default function MenuManagerClient({ categories, ingredients }: Props) {
  const router = useRouter()
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
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

  // Which categories to show in the grid
  const visibleCategories = activeCategory === 'all'
    ? categories
    : categories.filter(c => c.id === activeCategory)

  const activeCat = categories.find(c => c.id === activeCategory)

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Menu Manager</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {totalItems} items across {categories.length} categories · {unavailable} unavailable
          </p>
        </div>
        <button
          onClick={() => setPendingGate({ kind: 'add-category' })}
          className="flex items-center gap-1.5 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium shrink-0"
        >
          <Plus size={15} /> Add Category
        </button>
      </div>

      {/* ── Category tab bar ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-6">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
            activeCategory === 'all'
              ? 'bg-ink text-surface shadow-sm'
              : 'bg-white border border-ink/10 text-ink-muted hover:text-ink hover:border-ink/20'
          }`}
        >
          All items
          <span className={`ml-1.5 text-xs ${activeCategory === 'all' ? 'opacity-60' : 'text-ink-faint'}`}>
            {totalItems}
          </span>
        </button>

        {categories.map(cat => {
          const count = (cat.items ?? []).length
          const active = activeCategory === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                active
                  ? 'bg-ink text-surface shadow-sm'
                  : 'bg-white border border-ink/10 text-ink-muted hover:text-ink hover:border-ink/20'
              }`}
            >
              {cat.name}
              <span className={`ml-1.5 text-xs ${active ? 'opacity-60' : 'text-ink-faint'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Per-category sections ── */}
      <div className="space-y-8">
        {visibleCategories.map(cat => {
          const items = (cat.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
          return (
            <div key={cat.id}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-display font-semibold text-ink">{cat.name}</h2>
                  <span className="text-xs text-ink-faint">
                    {(cat.items ?? []).filter(i => i.is_available).length}/{(cat.items ?? []).length} available
                  </span>
                </div>
                <div className="flex-1 h-px bg-ink/5" />
                {/* Category actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPendingGate({ kind: 'add-item', category: cat })}
                    className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2.5 py-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
                  >
                    <Plus size={13} /> Add item
                  </button>
                  <button
                    onClick={() => setPendingGate({ kind: 'edit-category', category: cat })}
                    title="Edit category"
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setPendingGate({ kind: 'delete-category', category: cat })}
                    disabled={deleting}
                    title="Delete category"
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Items grid */}
              {items.length === 0 ? (
                <div className="border-2 border-dashed border-ink/8 rounded-2xl p-8 text-center">
                  <p className="text-ink-faint text-sm">No items in this category yet.</p>
                  <button
                    onClick={() => setPendingGate({ kind: 'add-item', category: cat })}
                    className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    + Add first item
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {items.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      toggling={toggling === item.id}
                      deleting={deleting}
                      onToggle={() => toggleAvailability(item)}
                      onRecipe={() => setRecipeFor(item)}
                      onEdit={() => setPendingGate({ kind: 'edit-item', item })}
                      onDelete={() => setPendingGate({ kind: 'delete-item', item })}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Modals (unchanged) ── */}
      {recipeFor && (
        <RecipeModal
          menuItem={recipeFor}
          ingredients={ingredients}
          onClose={() => setRecipeFor(null)}
          onSaved={() => { setRecipeFor(null); router.refresh() }}
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
