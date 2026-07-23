'use client'
import { ShoppingBag } from 'lucide-react'

interface Props {
  itemCount: number
  onOpen: () => void
}

export default function CartBar({ itemCount, onOpen }: Props) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 px-4 pb-safe-or-4 pb-4 max-w-2xl mx-auto">
      <button
        onClick={onOpen}
        className="w-full flex items-center justify-between bg-ink text-surface rounded-2xl px-5 py-4 shadow-lg active:scale-[0.98] transition-transform animate-slide-up"
      >
        <div className="flex items-center gap-3">
          <span className="relative">
            <ShoppingBag size={20} className="text-surface" />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-brand-400 rounded-full text-[10px] font-bold text-white flex items-center justify-center leading-none">
              {itemCount > 9 ? '9+' : itemCount}
            </span>
          </span>
          <span className="font-semibold text-sm">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
          </span>
        </div>

        <span className="text-sm font-semibold text-brand-300">
          View cart →
        </span>
      </button>
    </div>
  )
}
