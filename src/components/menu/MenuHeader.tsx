'use client'
import Image from 'next/image'
import type { Cafe, Table } from '@/lib/types'

interface Props {
  cafe: Cafe
  table: Table
  lang: 'en' | 'hi'
  onLangToggle: () => void
  filter: 'all' | 'veg' | 'nonveg'
  onFilterChange: (f: 'all' | 'veg' | 'nonveg') => void
}

export default function MenuHeader({ cafe, table, lang, onLangToggle, filter, onFilterChange }: Props) {
  const tableLabel = table.label ?? `Table ${table.number}`
  const hasHindi = cafe.settings.languages.includes('hi')

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-sm border-b border-ink/5">
      {/* Top row: logo + table badge + lang toggle */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 max-w-2xl mx-auto">
        {/* Logo / cafe name */}
        <div className="flex items-center gap-2.5">
          {cafe.logo_url ? (
            <div className="relative w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
              <Image
                src={cafe.logo_url}
                alt={cafe.name}
                fill
                className="object-cover"
                sizes="32px"
              />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand-400 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">{cafe.name[0]}</span>
            </div>
          )}
          <span className="font-display text-base font-semibold text-ink leading-tight">
            {cafe.name}
          </span>
        </div>

        {/* Right: table badge + lang toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-muted bg-surface-overlay border border-ink/8 px-2.5 py-1 rounded-full">
            {tableLabel}
          </span>

          {hasHindi && (
            <button
              onClick={onLangToggle}
              className="text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors"
              style={{
                borderColor: 'rgba(26,26,24,0.12)',
                backgroundColor: lang === 'hi' ? '#FF9500' : 'transparent',
                color: lang === 'hi' ? '#fff' : '#6B6B65',
              }}
            >
              {lang === 'en' ? 'अ' : 'A'}
            </button>
          )}
        </div>
      </div>

      {/* Filter row: All / Veg / Non-veg */}
      <div className="flex items-center gap-2 px-4 pb-3 max-w-2xl mx-auto">
        {(['all', 'veg', 'nonveg'] as const).map(opt => (
          <button
            key={opt}
            onClick={() => onFilterChange(opt)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              filter === opt
                ? 'bg-ink text-surface border-ink'
                : 'bg-transparent text-ink-muted border-ink/15 hover:border-ink/30'
            }`}
          >
            {opt === 'veg' && <VegDot green />}
            {opt === 'nonveg' && <VegDot green={false} />}
            {opt === 'all' ? 'All' : opt === 'veg' ? 'Veg' : 'Non-veg'}
          </button>
        ))}
      </div>
    </header>
  )
}

function VegDot({ green }: { green: boolean }) {
  return (
    <span
      className="w-2.5 h-2.5 rounded-sm border-2 flex-shrink-0 inline-flex items-center justify-center"
      style={{ borderColor: green ? '#22C55E' : '#EF4444' }}
    >
      <span
        className="w-1 h-1 rounded-full"
        style={{ backgroundColor: green ? '#22C55E' : '#EF4444' }}
      />
    </span>
  )
}
