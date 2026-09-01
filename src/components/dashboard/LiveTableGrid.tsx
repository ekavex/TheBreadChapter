import type { Section, Table, TableStatus } from '@/lib/types'

interface Props {
  sections: { section: Section; tables: Table[] }[]
}

const STATUS_STYLES: Record<TableStatus, string> = {
  free: 'bg-green-50 border-green-200 text-green-700',
  occupied: 'bg-amber-50 border-amber-200 text-amber-700',
  kot_sent: 'bg-orange-50 border-orange-200 text-orange-700',
  billed: 'bg-red-50 border-red-200 text-red-700',
}

const STATUS_LABELS: Record<TableStatus, string> = {
  free: 'Free',
  occupied: 'Occupied',
  kot_sent: 'KOT Sent',
  billed: 'Billed',
}

// Module 10 "live table statuses" - read-only manager view. Waiters act on
// these from /pos; this is just visibility.
export default function LiveTableGrid({ sections }: Props) {
  return (
    <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
      <h2 className="font-display text-lg font-semibold mb-4">Live table status</h2>
      <div className="space-y-4">
        {sections.map(({ section, tables }) => (
          <div key={section.id}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint mb-2">{section.name}</p>
            <div className="flex flex-wrap gap-2">
              {tables.map((table) => (
                <div
                  key={table.id}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium ${STATUS_STYLES[table.status]}`}
                  title={STATUS_LABELS[table.status]}
                >
                  {table.label || `T${table.number}`} · {STATUS_LABELS[table.status]}
                </div>
              ))}
              {tables.length === 0 && <p className="text-xs text-ink-faint">No tables</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
