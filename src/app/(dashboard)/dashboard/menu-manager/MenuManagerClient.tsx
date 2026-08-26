'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChefHat, Plus, Pencil, Trash2, Eye, EyeOff, UtensilsCrossed, Coffee, Search, X, AlertTriangle, Tag } from 'lucide-react'
import type { MenuCategory, MenuItem, Ingredient, Addon } from '@/lib/types'
import { formatPaisa, rupeesToPaisa } from '@/lib/money'
import toast from 'react-hot-toast'
import RecipeModal from './RecipeModal'
import ItemModal from './ItemModal'
import CategoryModal from './CategoryModal'

interface ConfirmState {
  title: string
  message: string
  onConfirm: () => void
}

function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmState & { onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 rounded-xl bg-red-50 shrink-0">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-ink text-base">{title}</h3>
              <p className="text-ink-muted text-sm mt-1 leading-relaxed">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex border-t border-ink/8">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay transition-colors"
          >
            Cancel
          </button>
          <div className="w-px bg-ink/8" />
          <button
            onClick={onConfirm}
            className="flex-1 py-3.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  categories: MenuCategory[]
  ingredients: Ingredient[]
  addons: Addon[]
}

type ModalKind =
  | { kind: 'add-category' }
  | { kind: 'edit-category'; category: MenuCategory }
  | { kind: 'add-item'; category: MenuCategory }
  | { kind: 'edit-item'; item: MenuItem }

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
  const costPaisa = item.cost_price_paisa ?? 0
  const hasRecipe = costPaisa > 0
  const pricePaisa = rupeesToPaisa(item.price)
  const profitPaisa = pricePaisa - costPaisa
  const profitPct = hasRecipe ? Math.round((profitPaisa / pricePaisa) * 100) : null

  return (
    <div className="flex flex-col bg-surface-raised rounded-2xl border border-ink/8 overflow-hidden h-full">
      {/* Availability toggle + category pill */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          {item.category === 'beverage'
            ? <Coffee size={13} className="text-ink-faint" />
            : <UtensilsCrossed size={13} className="text-ink-faint" />}
          <span className="text-[10px] font-medium text-ink-faint uppercase tracking-wide">
            {item.category}
          </span>
          {item.is_veg && (
            <span className="w-3.5 h-3.5 rounded-sm border-2 border-green-500 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          disabled={toggling}
          title={item.is_available ? 'Mark unavailable' : 'Mark available'}
          className={`p-1.5 rounded-lg transition-colors ${
            item.is_available
              ? 'text-green-600 hover:bg-red-50 hover:text-red-500'
              : 'text-ink-faint hover:bg-green-50 hover:text-green-600'
          } disabled:opacity-40`}
        >
          {item.is_available ? <Eye size={14} /> : <EyeOff size={14} />}
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

export default function MenuManagerClient({ categories, ingredients, addons: initialAddons }: Props) {
  const [addons, setAddons] = useState<Addon[]>(initialAddons)
  const [addingAddon, setAddingAddon] = useState(false)
  const [addonForm, setAddonForm] = useState({ name: '', price: '' })
  const [editingAddon, setEditingAddon] = useState<Addon | null>(null)
  const [editAddonForm, setEditAddonForm] = useState({ name: '', price: '' })
  const [addonBusy, setAddonBusy] = useState(false)
  const router = useRouter()
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [toggling, setToggling] = useState<string | null>(null)
  const [recipeFor, setRecipeFor] = useState<MenuItem | null>(null)
  const [activeModal, setActiveModal] = useState<ModalKind | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  function askConfirm(state: ConfirmState) {
    setConfirmState(state)
  }

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

  function deleteCategory(cat: MenuCategory) {
    askConfirm({
      title: `Delete "${cat.name}"?`,
      message: 'This will permanently delete the category. All items must be removed first.',
      onConfirm: async () => {
        setConfirmState(null)
        setDeleting(true)
        try {
          const res = await fetch(`/api/menu/categories/${cat.id}`, { method: 'DELETE' })
          const { error } = await res.json()
          if (error) throw new Error(error)
          toast.success('Category deleted')
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Delete failed')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  function deleteItem(item: MenuItem) {
    askConfirm({
      title: `Delete "${item.name}"?`,
      message: 'This item will be permanently removed from the menu.',
      onConfirm: async () => {
        setConfirmState(null)
        setDeleting(true)
        try {
          const res = await fetch(`/api/menu/items/${item.id}`, { method: 'DELETE' })
          const { error } = await res.json()
          if (error) throw new Error(error)
          toast.success('Item deleted')
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Delete failed')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  function refresh() {
    setActiveModal(null)
    router.refresh()
  }

  async function createAddon() {
    if (!addonForm.name.trim()) return
    setAddonBusy(true)
    try {
      const res = await fetch('/api/menu/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addonForm.name.trim(), price: Number(addonForm.price) || 0 }),
      })
      const { data, error } = await res.json()
      if (error) throw new Error(error)
      setAddons((prev) => [...prev, data as Addon])
      setAddonForm({ name: '', price: '' })
      setAddingAddon(false)
      toast.success('Add-on created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create add-on')
    } finally {
      setAddonBusy(false)
    }
  }

  async function updateAddon() {
    if (!editingAddon) return
    setAddonBusy(true)
    try {
      const res = await fetch(`/api/menu/addons/${editingAddon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editAddonForm.name.trim(), price: Number(editAddonForm.price) || 0 }),
      })
      const { data, error } = await res.json()
      if (error) throw new Error(error)
      setAddons((prev) => prev.map((a) => (a.id === editingAddon.id ? (data as Addon) : a)))
      setEditingAddon(null)
      toast.success('Add-on updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update add-on')
    } finally {
      setAddonBusy(false)
    }
  }

  async function toggleAddon(addon: Addon) {
    setAddonBusy(true)
    try {
      const res = await fetch(`/api/menu/addons/${addon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !addon.is_active }),
      })
      const { data, error } = await res.json()
      if (error) throw new Error(error)
      setAddons((prev) => prev.map((a) => (a.id === addon.id ? (data as Addon) : a)))
    } catch {
      toast.error('Update failed')
    } finally {
      setAddonBusy(false)
    }
  }

  function deleteAddon(addon: Addon) {
    askConfirm({
      title: `Delete "${addon.name}"?`,
      message: 'This add-on will be removed from the list. Existing orders are not affected.',
      onConfirm: async () => {
        setConfirmState(null)
        setAddonBusy(true)
        try {
          const res = await fetch(`/api/menu/addons/${addon.id}`, { method: 'DELETE' })
          const { error } = await res.json()
          if (error) throw new Error(error)
          setAddons((prev) => prev.filter((a) => a.id !== addon.id))
          toast.success('Add-on deleted')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Delete failed')
        } finally {
          setAddonBusy(false)
        }
      },
    })
  }

  // Which categories to show in the grid
  const visibleCategories = activeCategory === 'all'
    ? categories
    : categories.filter(c => c.id === activeCategory)

  // Search across all categories
  const searchQuery = search.trim().toLowerCase()
  const isSearching = searchQuery.length > 0
  const searchResults: (MenuItem & { categoryName: string })[] = isSearching
    ? categories.flatMap(cat =>
        (cat.items ?? [])
          .filter(item => {
            const name = item.name.toLowerCase()
            const desc = (item.description ?? '').toLowerCase()
            return name.includes(searchQuery) || desc.includes(searchQuery)
          })
          .map(item => ({ ...item, categoryName: cat.name }))
      )
    : []

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Menu Manager</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            {totalItems} items · {categories.length} categories · {unavailable} unavailable
          </p>
        </div>
        <button
          onClick={() => setActiveModal({ kind: 'add-category' })}
          className="flex items-center gap-1.5 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium shrink-0"
        >
          <Plus size={15} /> Add Category
        </button>
      </div>

      {/* ── Search bar ── */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items by name or description…"
          className="w-full rounded-xl border border-ink/10 bg-white pl-9 pr-9 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-ink-muted hover:text-ink transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Search results ── */}
      {isSearching ? (
        <div>
          <p className="text-xs text-ink-faint mb-4">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{search.trim()}&rdquo;
          </p>
          {searchResults.length === 0 ? (
            <div className="border-2 border-dashed border-ink/8 rounded-2xl p-12 text-center">
              <Search size={24} className="mx-auto text-ink-faint mb-3" />
              <p className="text-ink-muted text-sm">No items match your search</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {searchResults.map(item => (
                <div key={item.id} className="relative">
                  <span className="absolute -top-2 left-3 z-10 text-[10px] font-semibold text-ink-faint bg-surface-overlay border border-ink/8 px-2 py-0.5 rounded-full">
                    {item.categoryName}
                  </span>
                  <ItemCard
                    item={item}
                    toggling={toggling === item.id}
                    deleting={deleting}
                    onToggle={() => toggleAvailability(item)}
                    onRecipe={() => setRecipeFor(item)}
                    onEdit={() => setActiveModal({ kind: 'edit-item', item })}
                    onDelete={() => deleteItem(item)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>

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
                    onClick={() => setActiveModal({ kind: 'add-item', category: cat })}
                    className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2.5 py-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
                  >
                    <Plus size={13} /> Add item
                  </button>
                  <button
                    onClick={() => setActiveModal({ kind: 'edit-category', category: cat })}
                    title="Edit category"
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteCategory(cat)}
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
                    onClick={() => setActiveModal({ kind: 'add-item', category: cat })}
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
                      onEdit={() => setActiveModal({ kind: 'edit-item', item })}
                      onDelete={() => deleteItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

        </>
      )}

      {/* ── Add-ons section ── */}
      <div className="mt-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-ink-faint" />
            <h2 className="font-display font-semibold text-ink">Add-ons</h2>
            <span className="text-xs text-ink-faint">{addons.length} configured</span>
          </div>
          <div className="flex-1 h-px bg-ink/5" />
          <button
            onClick={() => setAddingAddon(true)}
            className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2.5 py-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
          >
            <Plus size={13} /> Add
          </button>
        </div>

        {addingAddon && (
          <div className="mb-4 flex items-center gap-2 bg-surface-raised border border-ink/8 rounded-xl p-3">
            <input
              type="text"
              value={addonForm.name}
              onChange={(e) => setAddonForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && createAddon()}
              placeholder="Add-on name (e.g. Extra shot)"
              autoFocus
              className="flex-1 rounded-lg border border-ink/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
            <div className="relative w-24">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">₹</span>
              <input
                type="number"
                min="0"
                value={addonForm.price}
                onChange={(e) => setAddonForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-ink/10 pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
              />
            </div>
            <button
              onClick={createAddon}
              disabled={addonBusy || !addonForm.name.trim()}
              className="px-3 py-2 rounded-lg bg-ink text-surface text-xs font-medium disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => { setAddingAddon(false); setAddonForm({ name: '', price: '' }) }}
              className="p-2 rounded-lg text-ink-faint hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {addons.length === 0 && !addingAddon && (
          <div className="border-2 border-dashed border-ink/8 rounded-2xl p-8 text-center">
            <Tag size={20} className="mx-auto text-ink-faint mb-2" />
            <p className="text-ink-faint text-sm">No add-ons configured yet.</p>
            <button
              onClick={() => setAddingAddon(true)}
              className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              + Add first add-on
            </button>
          </div>
        )}

        {addons.length > 0 && (
          <div className="space-y-2">
            {addons.map((addon) => (
              <div key={addon.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-surface-raised transition-colors ${addon.is_active ? 'border-ink/8' : 'border-ink/5 opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ink">{addon.name}</span>
                  {addon.price > 0 && <span className="ml-2 text-xs text-ink-muted">+₹{addon.price}</span>}
                  {!addon.is_active && <span className="ml-2 text-xs text-ink-faint">(inactive)</span>}
                </div>
                <button
                  onClick={() => toggleAddon(addon)}
                  disabled={addonBusy}
                  title={addon.is_active ? 'Deactivate' : 'Activate'}
                  className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${addon.is_active ? 'text-green-600 hover:bg-red-50 hover:text-red-500' : 'text-ink-faint hover:bg-green-50 hover:text-green-600'}`}
                >
                  {addon.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  onClick={() => { setEditingAddon(addon); setEditAddonForm({ name: addon.name, price: String(addon.price) }) }}
                  className="p-1.5 rounded-lg text-ink-faint hover:bg-surface-overlay hover:text-ink transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => deleteAddon(addon)}
                  disabled={addonBusy}
                  className="p-1.5 rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {recipeFor && (
        <RecipeModal
          menuItem={recipeFor}
          ingredients={ingredients}
          onClose={() => setRecipeFor(null)}
          onSaved={() => { setRecipeFor(null); router.refresh() }}
        />
      )}

      {activeModal?.kind === 'add-category' && (
        <CategoryModal onClose={() => setActiveModal(null)} onSaved={refresh} />
      )}
      {activeModal?.kind === 'edit-category' && (
        <CategoryModal category={activeModal.category} onClose={() => setActiveModal(null)} onSaved={refresh} />
      )}
      {activeModal?.kind === 'add-item' && (
        <ItemModal
          categories={categories}
          defaultCategoryId={activeModal.category.id}
          onClose={() => setActiveModal(null)}
          onSaved={refresh}
        />
      )}
      {activeModal?.kind === 'edit-item' && (
        <ItemModal
          item={activeModal.item}
          categories={categories}
          onClose={() => setActiveModal(null)}
          onSaved={refresh}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* ── Edit addon modal ── */}
      {editingAddon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-ink/5">
              <h3 className="font-display font-semibold text-ink">Edit Add-on</h3>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text"
                value={editAddonForm.name}
                onChange={(e) => setEditAddonForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Add-on name"
                className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">₹</span>
                <input
                  type="number"
                  min="0"
                  value={editAddonForm.price}
                  onChange={(e) => setEditAddonForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="0 for free"
                  className="w-full rounded-xl border border-ink/10 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>
            </div>
            <div className="flex border-t border-ink/5">
              <button onClick={() => setEditingAddon(null)} className="flex-1 py-3.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay">Cancel</button>
              <div className="w-px bg-ink/5" />
              <button onClick={updateAddon} disabled={addonBusy} className="flex-1 py-3.5 text-sm font-semibold text-ink hover:bg-surface-overlay disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
