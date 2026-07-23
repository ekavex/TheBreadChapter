'use client'
import { useState } from 'react'
import Image from 'next/image'
import { Flame, Plus, Minus } from 'lucide-react'
import { useCartStore } from '@/lib/hooks/useCart'
import type { MenuItem } from '@/lib/types'
import toast from 'react-hot-toast'

interface Props {
  item: MenuItem
  lang: 'en' | 'hi'
  showSocialProof: boolean
}

const SPICE_ICONS = ['', '🌶', '🌶🌶', '🌶🌶🌶']

export default function MenuItemCard({ item, lang, showSocialProof }: Props) {
  const { addItem, updateQuantity, cart } = useCartStore()
  const [customising, setCustomising] = useState(false)
  const [note, setNote] = useState('')

  const cartItem = cart?.items.find(i => i.menuItem.id === item.id)
  const qty = cartItem?.quantity ?? 0

  const name = lang === 'hi' && item.name_hi ? item.name_hi : item.name
  const desc = lang === 'hi' && item.description_hi ? item.description_hi : item.description

  function handleAdd() {
    addItem(item, 1, note || undefined)
    toast.success(`${item.name} added`)
  }

  return (
    <div className={`
      bg-surface-raised rounded-2xl border border-ink/5 overflow-hidden
      transition-all duration-200 animate-fade-in
      ${!item.is_available ? 'opacity-50' : ''}
    `}>
      <div className="flex gap-3 p-3">
        {/* Item info */}
        <div className="flex-1 min-w-0">
          {/* Veg / non-veg indicator */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={item.is_veg ? 'veg-dot' : 'nonveg-dot'} title={item.is_veg ? 'Vegetarian' : 'Non-vegetarian'} />
            {item.spice_level > 0 && (
              <span className="text-xs text-ink-muted">{SPICE_ICONS[item.spice_level]}</span>
            )}
            {item.is_featured && (
              <span className="text-[10px] font-medium text-brand-500 bg-brand-50 px-1.5 py-0.5 rounded-full">
                Popular
              </span>
            )}
          </div>

          <h3 className="font-display text-base font-semibold text-ink leading-tight">{name}</h3>

          {desc && (
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed line-clamp-2">{desc}</p>
          )}

          {/* Social proof */}
          {showSocialProof && item.order_count > 50 && (
            <div className="flex items-center gap-1 mt-1.5">
              <Flame size={11} className="text-brand-400" />
              <span className="text-[11px] text-ink-muted">
                Ordered {item.order_count}+ times today
              </span>
            </div>
          )}

          <div className="flex items-center justify-between mt-2">
            <span className="font-semibold text-ink text-base">₹{item.price}</span>

            {/* Add / quantity controls */}
            {!item.is_available ? (
              <span className="text-xs text-ink-faint bg-surface-overlay px-3 py-1.5 rounded-full">
                Unavailable
              </span>
            ) : qty === 0 ? (
              <button
                onClick={handleAdd}
                className="flex items-center gap-1 bg-brand-400 hover:bg-brand-500 text-white text-sm font-medium px-4 py-1.5 rounded-full transition-colors active:scale-95"
              >
                <Plus size={14} />
                Add
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-surface-overlay rounded-full px-1 py-1">
                <button
                  onClick={() => updateQuantity(item.id, qty - 1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-ink/10 transition-colors"
                >
                  <Minus size={14} className="text-ink" />
                </button>
                <span className="text-sm font-semibold text-ink w-4 text-center">{qty}</span>
                <button
                  onClick={() => updateQuantity(item.id, qty + 1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-brand-400 hover:bg-brand-500 transition-colors"
                >
                  <Plus size={14} className="text-white" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Item image */}
        {item.image_url && (
          <div className="relative w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden">
            <Image
              src={item.image_url}
              alt={name}
              fill
              className="object-cover"
              sizes="96px"
            />
          </div>
        )}
      </div>
    </div>
  )
}
