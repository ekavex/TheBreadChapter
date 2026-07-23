'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import type { Section, Table, TableStatus } from '@/lib/types'

interface Props {
  bySection: { section: Section; tables: Table[] }[]
}

const STATUS_STYLES: Record<TableStatus, string> = {
  free: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100',
  occupied: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
  kot_sent: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100',
  billed: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
}

const STATUS_LABELS: Record<TableStatus, string> = {
  free: 'Free',
  occupied: 'Occupied',
  kot_sent: 'KOT Sent',
  billed: 'Billed',
}

export default function PosTablesClient({ bySection }: Props) {
  const router = useRouter()
  const [opening, setOpening] = useState<string | null>(null)

  async function selectTable(table: Table) {
    setOpening(table.id)
    try {
      const res = await fetch('/api/pos/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: table.id }),
      })
      const { data, error } = await res.json()
      if (error) throw new Error(error)
      router.push(`/pos/order/${data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open table')
      setOpening(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">Waiter POS</h1>
        <p className="text-ink-muted text-sm mt-0.5">Select a table by section to start or resume an order</p>
      </div>

      <div className="space-y-6">
        {bySection.map(({ section, tables }) => (
          <div key={section.id}>
            <h2 className="font-display font-semibold text-ink mb-3">{section.name}</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {tables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => selectTable(table)}
                  disabled={opening === table.id}
                  className={`rounded-2xl border-2 p-4 text-center transition-colors disabled:opacity-50 ${STATUS_STYLES[table.status]}`}
                >
                  <p className="font-display text-lg font-bold">T{table.number}</p>
                  {table.label && <p className="text-xs opacity-75 truncate">{table.label}</p>}
                  <p className="text-[10px] uppercase tracking-wide mt-1 font-medium">{STATUS_LABELS[table.status]}</p>
                </button>
              ))}
              {tables.length === 0 && <p className="text-sm text-ink-faint col-span-full">No tables in this section.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
