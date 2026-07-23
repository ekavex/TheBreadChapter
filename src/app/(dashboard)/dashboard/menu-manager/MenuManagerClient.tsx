'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import type { MenuCategory, MenuItem } from '@/lib/types'
import toast from 'react-hot-toast'

interface Props { categories: MenuCategory[] }

export default function MenuManagerClient({ categories }: Props) {
  const router = useRouter()
  const [toggling, setToggling] = useState<string | null>(null)

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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">Menu Manager</h1>
        <p className="text-ink-muted text-sm mt-0.5">
          {totalItems} items · {unavailable} unavailable
        </p>
      </div>

      <div className="space-y-6">
        {categories.map(cat => (
          <div key={cat.id} className="bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden">
            {/* Category header */}
            <div className="px-5 py-3.5 border-b border-ink/5 bg-surface-overlay flex items-center justify-between">
              <h2 className="font-display font-semibold text-ink">{cat.name}</h2>
              <span className="text-xs text-ink-faint">
                {(cat.items ?? []).filter(i => i.is_available).length} / {(cat.items ?? []).length} available
              </span>
            </div>

            {/* Items */}
            <div className="divide-y divide-ink/5">
              {(cat.items ?? [])
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(item => (
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
                      <p className="text-sm font-medium text-ink leading-tight">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-ink-faint mt-0.5 truncate">{item.description}</p>
                      )}
                    </div>

                    <span className="text-sm font-semibold text-ink shrink-0">₹{item.price}</span>

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
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
