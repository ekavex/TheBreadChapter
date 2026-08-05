'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Loader2, UtensilsCrossed, Receipt, CheckCircle2, Circle,
  ArrowLeft, Settings, Pencil, Trash2, Plus, X,
} from 'lucide-react'
import Link from 'next/link'
import type { Section, Table, TableStatus } from '@/lib/types'

interface Props {
  bySection: { section: Section; tables: Table[] }[]
}

// ── Status meta ────────────────────────────────────────────────
const STATUS_META: Record<TableStatus, {
  label: string
  dot: string
  card: string
  badge: string
  icon: React.ReactNode
}> = {
  free: {
    label: 'Available',
    dot: 'bg-emerald-400',
    card: 'bg-white border-slate-200 hover:border-brand-400 hover:shadow-md',
    badge: 'bg-emerald-50 text-emerald-700',
    icon: <Circle size={12} className="fill-emerald-400 text-emerald-400" />,
  },
  occupied: {
    label: 'Occupied',
    dot: 'bg-amber-400',
    card: 'bg-amber-50 border-amber-200 hover:border-amber-400 hover:shadow-md',
    badge: 'bg-amber-100 text-amber-700',
    icon: <UtensilsCrossed size={12} className="text-amber-500" />,
  },
  kot_sent: {
    label: 'KOT Sent',
    dot: 'bg-orange-400',
    card: 'bg-orange-50 border-orange-200 hover:border-orange-400 hover:shadow-md',
    badge: 'bg-orange-100 text-orange-700',
    icon: <UtensilsCrossed size={12} className="text-orange-500" />,
  },
  billed: {
    label: 'Billed',
    dot: 'bg-blue-400',
    card: 'bg-blue-50 border-blue-200 hover:border-blue-400 hover:shadow-md',
    badge: 'bg-blue-100 text-blue-700',
    icon: <Receipt size={12} className="text-blue-500" />,
  },
}

// ── Table card (normal mode) ───────────────────────────────────
function TableCard({
  table, loading, manageMode, onClick, onEdit, onDelete,
}: {
  table: Table
  loading: boolean
  manageMode: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const meta = STATUS_META[table.status]

  return (
    <div className={`relative rounded-2xl border-2 transition-all duration-200 select-none
      ${manageMode ? 'border-brand-300 bg-brand-50' : meta.card}
      ${loading ? 'opacity-60' : ''}
    `}>
      {/* Manage-mode overlay actions */}
      {manageMode && (
        <div className="absolute -top-2 -right-2 flex gap-1 z-10">
          <button
            onClick={onEdit}
            className="w-6 h-6 rounded-full bg-white border border-ink/10 shadow flex items-center justify-center text-ink-muted hover:text-ink hover:border-ink/30 transition-colors"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={onDelete}
            className="w-6 h-6 rounded-full bg-white border border-red-200 shadow flex items-center justify-center text-red-400 hover:text-red-600 hover:border-red-400 transition-colors"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      <button
        onClick={manageMode ? onEdit : onClick}
        disabled={loading}
        className="w-full p-5 text-left cursor-pointer active:scale-95 transition-transform disabled:cursor-wait"
      >
        {/* Status dot */}
        {!manageMode && (
          <span className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${meta.dot}
            ${table.status === 'free' ? 'animate-pulse' : ''}`}
          />
        )}

        <p className="font-display text-3xl font-bold text-ink leading-none mb-1">
          {table.number}
        </p>
        {table.label && (
          <p className="text-xs text-ink-faint truncate mb-2">{table.label}</p>
        )}
        {table.capacity && (
          <p className="text-[10px] text-ink-faint mb-1">{table.capacity} seats</p>
        )}

        {!manageMode && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${meta.badge}`}>
            {meta.icon}
            {meta.label}
          </span>
        )}
        {manageMode && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-600">
            <Pencil size={9} /> tap to edit
          </span>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/60">
            <Loader2 size={20} className="animate-spin text-brand-500" />
          </div>
        )}
      </button>
    </div>
  )
}

// ── Table modal (add / edit) ────────────────────────────────────
function TableModal({
  table,
  sections,
  onClose,
  onSaved,
}: {
  table?: Table
  sections: Section[]
  onClose: () => void
  onSaved: () => void
}) {
  const [number, setNumber] = useState(table?.number?.toString() ?? '')
  const [label, setLabel] = useState(table?.label ?? '')
  const [capacity, setCapacity] = useState(table?.capacity?.toString() ?? '4')
  const [sectionId, setSectionId] = useState<string>(
    table?.section_id?.toString() ?? sections[0]?.id?.toString() ?? ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!number || isNaN(Number(number))) {
      toast.error('Enter a valid table number')
      return
    }
    setSaving(true)
    try {
      const body = {
        number: Number(number),
        label: label.trim() || null,
        capacity: Number(capacity) || 4,
        section_id: Number(sectionId),
      }
      const res = table
        ? await fetch(`/api/pos/tables/${table.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/pos/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success(table ? 'Table updated' : 'Table added')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/5">
          <h2 className="font-display font-semibold text-ink">
            {table ? `Edit Table ${table.number}` : 'Add Table'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1.5">Table number *</label>
            <input
              type="number"
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder="e.g. 5"
              className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1.5">Label <span className="text-ink-faint font-normal">(optional)</span></label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Window seat, Corner"
              className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink-muted block mb-1.5">Capacity</label>
              <input
                type="number"
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                min={1}
                className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted block mb-1.5">Section *</label>
              <select
                value={sectionId}
                onChange={e => setSectionId(e.target.value)}
                className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 bg-white"
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-ink/10 px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : table ? 'Save changes' : 'Add table'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status legend ──────────────────────────────────────────────
function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-4">
      {(Object.entries(STATUS_META) as [TableStatus, typeof STATUS_META[TableStatus]][]).map(([, meta]) => (
        <span key={meta.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function PosTablesClient({ bySection }: Props) {
  const router = useRouter()
  const [opening, setOpening] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<number | 'all'>('all')
  const [manageMode, setManageMode] = useState(false)
  const [editingTable, setEditingTable] = useState<Table | null | undefined>(undefined) // undefined=closed, null=add new
  const [addToSection, setAddToSection] = useState<Section | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const allSections = bySection.map(({ section }) => section)
  const allTables = bySection.flatMap(({ tables }) => tables)
  const counts: Record<TableStatus, number> = { free: 0, occupied: 0, kot_sent: 0, billed: 0 }
  allTables.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1 })

  async function selectTable(table: Table) {
    setOpening(table.id)
    try {
      if (table.status === 'free') {
        // Don't create a DB order yet — navigate to the new-order page so no
        // empty order gets counted on the dashboard until items are added.
        router.push(`/pos/order/new?tableId=${table.id}`)
      } else {
        // Table already has an active order — resume it
        const res = await fetch('/api/pos/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: table.id }),
        })
        const { data, error } = await res.json()
        if (error) throw new Error(error)
        router.push(`/pos/order/${data.id}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open table')
      setOpening(null)
    }
  }

  async function deleteTable(table: Table) {
    if (!confirm(`Remove Table ${table.number}? This cannot be undone.`)) return
    setDeletingId(table.id)
    try {
      const res = await fetch(`/api/pos/tables/${table.id}`, { method: 'DELETE' })
      const { error } = await res.json()
      if (error) throw new Error(error)
      toast.success(`Table ${table.number} removed`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove table')
    } finally {
      setDeletingId(null)
    }
  }

  const visibleSections = activeSection === 'all'
    ? bySection
    : bySection.filter(({ section }) => section.id === activeSection)

  const modalSection = addToSection ?? allSections[0] ?? null

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-ink/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
            >
              <ArrowLeft size={15} />
              Dashboard
            </Link>
            <div className="h-4 w-px bg-ink/10" />
            <div>
              <h1 className="font-display text-xl font-bold text-ink">
                {manageMode ? 'Manage Tables' : 'Floor View'}
              </h1>
              <p className="text-xs text-ink-faint mt-0.5">The Bread Chapter · Waiter POS</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Summary chips — hidden in manage mode */}
            {!manageMode && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
                  <CheckCircle2 size={12} /> {counts.free} Free
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
                  <UtensilsCrossed size={12} /> {counts.occupied + counts.kot_sent} Active
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                  <Receipt size={12} /> {counts.billed} Billed
                </span>
              </div>
            )}

            {/* Manage toggle */}
            <button
              onClick={() => setManageMode(m => !m)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                manageMode
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-surface-overlay text-ink-muted hover:text-ink hover:bg-surface-raised border border-ink/10'
              }`}
            >
              <Settings size={14} />
              {manageMode ? 'Done managing' : 'Manage tables'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* Manage-mode banner */}
        {manageMode && (
          <div className="mb-5 px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-700 flex items-center gap-2">
            <Settings size={14} className="shrink-0" />
            You are in table management mode. Tap a card to edit, or use the
            <span className="font-semibold mx-0.5">+ Add table</span> button to create new ones.
          </div>
        )}

        {/* ── Section tabs ── */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveSection('all')}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              activeSection === 'all'
                ? 'bg-ink text-surface shadow-sm'
                : 'bg-white border border-ink/10 text-ink-muted hover:text-ink hover:border-ink/20'
            }`}
          >
            All sections
          </button>
          {bySection.map(({ section, tables }) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                activeSection === section.id
                  ? 'bg-ink text-surface shadow-sm'
                  : 'bg-white border border-ink/10 text-ink-muted hover:text-ink hover:border-ink/20'
              }`}
            >
              {section.name}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                activeSection === section.id ? 'bg-white/20 text-surface' : 'bg-surface text-ink-faint'
              }`}>
                {tables.length}
              </span>
            </button>
          ))}
        </div>

        {/* ── Sections + tables ── */}
        <div className="space-y-8">
          {visibleSections.map(({ section, tables }) => (
            <div key={section.id}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="font-display font-semibold text-ink">{section.name}</h2>
                <div className="flex-1 h-px bg-ink/5" />
                <span className="text-xs text-ink-faint">{tables.length} tables</span>
                {manageMode && (
                  <button
                    onClick={() => { setAddToSection(section); setEditingTable(null) }}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus size={12} /> Add table
                  </button>
                )}
              </div>

              {/* Grid */}
              {tables.length === 0 && !manageMode && (
                <p className="text-sm text-ink-faint py-4">No tables in this section.</p>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {tables.map(table => (
                  <TableCard
                    key={table.id}
                    table={table}
                    loading={opening === table.id || deletingId === table.id}
                    manageMode={manageMode}
                    onClick={() => selectTable(table)}
                    onEdit={() => { setAddToSection(null); setEditingTable(table) }}
                    onDelete={() => deleteTable(table)}
                  />
                ))}

                {/* "Add table" ghost card — only in manage mode */}
                {manageMode && (
                  <button
                    onClick={() => { setAddToSection(section); setEditingTable(null) }}
                    className="rounded-2xl border-2 border-dashed border-brand-300 p-5 text-center text-brand-400 hover:bg-brand-50 hover:text-brand-600 transition-colors min-h-[96px] flex flex-col items-center justify-center gap-1"
                  >
                    <Plus size={20} />
                    <span className="text-xs font-medium">Add table</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Legend (normal mode only) */}
        {!manageMode && (
          <div className="mt-8 pt-6 border-t border-ink/5">
            <StatusLegend />
          </div>
        )}
      </div>

      {/* ── Table modal ── */}
      {editingTable !== undefined && (
        <TableModal
          table={editingTable ?? undefined}
          sections={allSections}
          onClose={() => { setEditingTable(undefined); setAddToSection(null) }}
          onSaved={() => { setEditingTable(undefined); setAddToSection(null); router.refresh() }}
        />
      )}
    </div>
  )
}
