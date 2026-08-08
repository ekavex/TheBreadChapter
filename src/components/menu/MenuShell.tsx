'use client'
import { useEffect, useState } from 'react'
import { useCartStore } from '@/lib/hooks/useCart'
import type { MenuPageData, MenuCategory, MenuItem } from '@/lib/types'
import MenuHeader from './MenuHeader'
import CategoryNav from './CategoryNav'
import MenuItemCard from './MenuItemCard'
import CartBar from './CartBar'
import CartSheet from './CartSheet'

interface Props { data: MenuPageData }

export default function MenuShell({ data }: Props) {
  const { cafe, table, categories } = data
  const { initCart, itemCount } = useCartStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [lang, setLang] = useState<'en' | 'hi'>('en')
  const [filter, setFilter] = useState<'all' | 'veg' | 'nonveg'>('all')
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? '')
  const [search, setSearch] = useState('')

  useEffect(() => {
    useCartStore.persist.rehydrate()
    initCart(cafe.id, table.id, table.number)
  }, [cafe.id, table.id, table.number])

  const filteredCategories: MenuCategory[] = categories.map(cat => ({
    ...cat,
    items: (cat.items ?? []).filter(item => {
      if (!item.is_available) return false
      if (filter === 'veg') return item.is_veg
      if (filter === 'nonveg') return !item.is_veg
      return true
    }),
  })).filter(cat => (cat.items ?? []).length > 0)

  // Search across all categories (applies on top of veg/nonveg filter)
  const searchQuery = search.trim().toLowerCase()
  const searchResults: MenuItem[] = searchQuery
    ? filteredCategories.flatMap(cat => (cat.items ?? []).filter(item => {
        const name = (lang === 'hi' && item.name_hi ? item.name_hi : item.name).toLowerCase()
        const desc = (lang === 'hi' && item.description_hi ? item.description_hi : item.description ?? '').toLowerCase()
        return name.includes(searchQuery) || desc.includes(searchQuery)
      }))
    : []

  const isSearching = searchQuery.length > 0

  return (
    <div className="min-h-screen bg-surface">
      <MenuHeader
        cafe={cafe}
        table={table}
        lang={lang}
        onLangToggle={() => setLang(l => l === 'en' ? 'hi' : 'en')}
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
      />

      {!isSearching && (
        <CategoryNav
          categories={filteredCategories}
          activeCat={activeCat}
          onSelect={setActiveCat}
          lang={lang}
        />
      )}

      <main className="px-4 pb-32 max-w-2xl mx-auto">
        {/* ── Search results ── */}
        {isSearching ? (
          <section className="pt-4">
            <p className="text-xs text-ink-faint mb-4">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{search.trim()}&rdquo;
            </p>
            {searchResults.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-ink-muted text-sm">No items found</p>
                <p className="text-xs text-ink-faint mt-1">Try a different name or remove the diet filter</p>
              </div>
            ) : (
              <div className="space-y-3">
                {searchResults.map((item: MenuItem) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    lang={lang}
                    showSocialProof={cafe.settings.show_social_proof}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          /* ── Normal category view ── */
          filteredCategories.map(cat => (
            <section key={cat.id} id={`cat-${cat.id}`} className="mb-8">
              <h2 className="font-display text-xl font-semibold text-ink mb-4 pt-4">
                {lang === 'hi' && cat.name_hi ? cat.name_hi : cat.name}
              </h2>
              <div className="space-y-3">
                {(cat.items ?? [])
                  .sort((a, b) => b.order_count - a.order_count)
                  .map((item: MenuItem) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      lang={lang}
                      showSocialProof={cafe.settings.show_social_proof}
                    />
                  ))}
              </div>
            </section>
          ))
        )}
      </main>

      {itemCount() > 0 && (
        <CartBar itemCount={itemCount()} onOpen={() => setCartOpen(true)} />
      )}

      {cartOpen && (
        <CartSheet
          cafe={cafe}
          table={table}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  )
}
