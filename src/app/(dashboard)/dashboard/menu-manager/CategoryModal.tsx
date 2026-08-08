'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { MenuCategory } from '@/lib/types'

interface Props {
  category?: MenuCategory | null
  onClose: () => void
  onSaved: () => void
}

export default function CategoryModal({ category, onClose, onSaved }: Props) {
  const isEdit = !!category
  const [name, setName] = useState(category?.name ?? '')
  const [nameHi, setNameHi] = useState(category?.name_hi ?? '')
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const payload = { name: name.trim(), name_hi: nameHi.trim() || null, sort_order: Number(sortOrder) }
      const res = await fetch(isEdit ? `/api/menu/categories/${category!.id}` : '/api/menu/categories', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { error } = await res.json()
      if (error) { toast.error(error); return }

      toast.success(isEdit ? 'Category updated' : 'Category added')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-sm p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-ink">{isEdit ? 'Edit Category' : 'Add Category'}</h2>
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
            <label className="block text-sm font-medium text-ink-muted mb-1">Sort order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add category'}
          </button>
        </form>
      </div>
    </div>
  )
}
