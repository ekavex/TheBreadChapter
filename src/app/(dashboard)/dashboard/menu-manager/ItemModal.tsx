'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { MenuItem, MenuCategory, MenuItemCategory } from '@/lib/types'

interface Props {
  item?: MenuItem | null
  categories: MenuCategory[]
  defaultCategoryId?: string
  token: string
  onClose: () => void
  onSaved: () => void
}

export default function ItemModal({ item, categories, defaultCategoryId, token, onClose, onSaved }: Props) {
  const isEdit = !!item
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId ?? categories[0]?.id ?? '')
  const [name, setName] = useState(item?.name ?? '')
  const [nameHi, setNameHi] = useState(item?.name_hi ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item?.price ?? 0)
  const [category, setCategory] = useState<MenuItemCategory>(item?.category ?? 'food')
  const [isVeg, setIsVeg] = useState(item?.is_veg ?? true)
  const [spiceLevel, setSpiceLevel] = useState<0 | 1 | 2 | 3>(item?.spice_level ?? 0)
  const [prepTimeMins, setPrepTimeMins] = useState(item?.prep_time_mins ?? 10)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !categoryId) return toast.error('Name and category are required')
    setSaving(true)
    try {
      const payload = {
        category_id: categoryId,
        name: name.trim(),
        name_hi: nameHi.trim() || null,
        description: description.trim() || null,
        price: Number(price),
        category,
        is_veg: isVeg,
        spice_level: spiceLevel,
        prep_time_mins: Number(prepTimeMins),
      }

      const res = await fetch(isEdit ? `/api/menu/items/${item!.id}` : '/api/menu/items', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-menu-crud-token': token },
        body: JSON.stringify(payload),
      })
      const { error } = await res.json()
      if (error) {
        if (res.status === 401) toast.error('Menu session expired — click Add/Edit again to re-verify')
        else toast.error(error)
        return
      }

      toast.success(isEdit ? 'Item updated' : 'Item added')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-md p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-ink">{isEdit ? 'Edit Item' : 'Add Item'}</h2>
          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Name (Hindi, optional)</label>
            <input
              value={nameHi}
              onChange={(e) => setNameHi(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Price (₹)</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Prep time (mins)</label>
              <input
                type="number"
                value={prepTimeMins}
                onChange={(e) => setPrepTimeMins(Number(e.target.value))}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">
              KOT station (Module 5 routing)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['food', 'beverage'] as MenuItemCategory[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border capitalize transition-colors ${
                    category === c
                      ? 'bg-ink text-surface border-ink'
                      : 'border-ink/10 text-ink-muted hover:bg-surface-overlay'
                  }`}
                >
                  {c === 'food' ? 'Food → Kitchen' : 'Beverage → Counter'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={isVeg} onChange={(e) => setIsVeg(e.target.checked)} className="rounded border-ink/20" />
              Vegetarian
            </label>
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Spice level</label>
              <select
                value={spiceLevel}
                onChange={(e) => setSpiceLevel(Number(e.target.value) as 0 | 1 | 2 | 3)}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              >
                {[0, 1, 2, 3].map((l) => (
                  <option key={l} value={l}>{l === 0 ? 'None' : '🌶'.repeat(l)}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
          </button>
        </form>
      </div>
    </div>
  )
}
