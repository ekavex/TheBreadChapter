'use client'
import { useRef, useEffect } from 'react'
import type { MenuCategory } from '@/lib/types'

interface Props {
  categories: MenuCategory[]
  activeCat: string
  onSelect: (id: string) => void
  lang: 'en' | 'hi'
}

export default function CategoryNav({ categories, activeCat, onSelect, lang }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Scroll active pill into view when activeCat changes
  useEffect(() => {
    const el = pillRefs.current[activeCat]
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [activeCat])

  function handleSelect(id: string) {
    onSelect(id)
    // Scroll menu section into view
    const section = document.getElementById(`cat-${id}`)
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (categories.length === 0) return null

  return (
    <nav className="sticky top-[88px] z-20 bg-surface/95 backdrop-blur-sm border-b border-ink/5">
      <div
        ref={scrollRef}
        className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none max-w-2xl mx-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {categories.map(cat => {
          const name = lang === 'hi' && cat.name_hi ? cat.name_hi : cat.name
          const active = cat.id === activeCat
          return (
            <button
              key={cat.id}
              ref={el => { pillRefs.current[cat.id] = el }}
              onClick={() => handleSelect(cat.id)}
              className={`flex-shrink-0 text-sm font-medium px-4 py-1.5 rounded-full transition-all duration-200 whitespace-nowrap ${
                active
                  ? 'bg-brand-400 text-white shadow-sm'
                  : 'bg-surface-overlay text-ink-muted hover:text-ink hover:bg-surface-overlay/80'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
