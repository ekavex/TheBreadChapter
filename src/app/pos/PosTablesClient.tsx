'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Loader2, UtensilsCrossed, Receipt, CheckCircle2,
  ArrowLeft, Settings, Pencil, Trash2, Plus, X, Users,
} from 'lucide-react'
import Link from 'next/link'
import type { Section, Table, TableStatus } from '@/lib/types'

type TableShape = 'round' | 'square' | 'rectangle'

interface Props {
  bySection: { section: Section; tables: Table[] }[]
}

// ── Status colours ─────────────────────────────────────────────
const STATUS: Record<TableStatus, {
  label: string
  dot: string
  card: string
  badge: string
  tableColor: string   // SVG table fill
  tableBorder: string  // SVG table stroke
  seatColor: string    // SVG seat fill
}> = {
  free: {
    label: 'Available',
    dot: 'bg-emerald-400',
    card: 'hover:border-emerald-400 hover:shadow-lg border-slate-200',
    badge: 'bg-emerald-50 text-emerald-700',
    tableColor: '#f0fdf4', tableBorder: '#4ade80', seatColor: '#bbf7d0',
  },
  occupied: {
    label: 'Occupied',
    dot: 'bg-amber-400',
    card: 'border-amber-300 bg-amber-50/60 hover:shadow-lg',
    badge: 'bg-amber-100 text-amber-700',
    tableColor: '#fffbeb', tableBorder: '#f59e0b', seatColor: '#fde68a',
  },
  kot_sent: {
    label: 'KOT Sent',
    dot: 'bg-orange-400',
    card: 'border-orange-300 bg-orange-50/60 hover:shadow-lg',
    badge: 'bg-orange-100 text-orange-700',
    tableColor: '#fff7ed', tableBorder: '#f97316', seatColor: '#fed7aa',
  },
  billed: {
    label: 'Billed',
    dot: 'bg-blue-400',
    card: 'border-blue-300 bg-blue-50/60 hover:shadow-lg',
    badge: 'bg-blue-100 text-blue-700',
    tableColor: '#eff6ff', tableBorder: '#60a5fa', seatColor: '#bfdbfe',
  },
}

// ── Table shape SVG ───────────────────���────────────────────────
// Draws the table geometry + seats around it inside a 100×100 viewBox.
// Seats are scaled/distributed to match the given capacity.

function RoundTable({ capacity, tc, tb, sc, label }: { capacity: number; tc: string; tb: string; sc: string; label: string }) {
  const seats = Math.max(1, Math.min(capacity, 10))
  const cx = 50, cy = 52, r = 24, seatR = 5.5, gap = 7
  const chairs = Array.from({ length: seats }, (_, i) => {
    const a = (i / seats) * 2 * Math.PI - Math.PI / 2
    return { x: cx + (r + gap) * Math.cos(a), y: cy + (r + gap) * Math.sin(a) }
  })
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      {chairs.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={seatR} fill={sc} stroke={tb} strokeWidth="1.5" />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={tc} stroke={tb} strokeWidth="2.5" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={tb} fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  )
}

function SquareTable({ capacity, tc, tb, sc, label }: { capacity: number; tc: string; tb: string; sc: string; label: string }) {
  // Distribute seats: 1 per side, extras go to top/bottom
  const seats = Math.max(1, Math.min(capacity, 12))
  const perSide = Math.max(1, Math.round(seats / 4))
  const topCount = Math.ceil(seats / 4)
  const bottomCount = Math.ceil(seats / 4)
  const leftCount  = Math.floor(seats / 4)
  const rightCount = seats - topCount - bottomCount - leftCount

  const W = 40, H = 40
  const x0 = 30, y0 = 30
  const cx = x0 + W / 2, cy = y0 + H / 2
  const seatW = 8, seatH = 5.5, gap = 5

  function row(count: number, axis: 'h' | 'v', fixed: number, from: number, len: number, flip: boolean): React.ReactNode[] {
    if (count <= 0) return []
    const spacing = len / count
    return Array.from({ length: count }, (_, i) => {
      const t = from + spacing * (i + 0.5)
      const sx = axis === 'h' ? t : (flip ? fixed - gap - seatH : fixed + gap)
      const sy = axis === 'h' ? (flip ? fixed - gap - seatH : fixed + gap) : t
      const rw = axis === 'h' ? seatW : seatH
      const rh = axis === 'h' ? seatH : seatW
      return <rect key={`${axis}${flip}${i}`} x={sx - rw / 2} y={sy - rh / 2} width={rw} height={rh} rx="2" fill={sc} stroke={tb} strokeWidth="1.5" />
    })
  }

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      {row(topCount,    'h', y0,      x0, W, true)}
      {row(bottomCount, 'h', y0 + H,  x0, W, false)}
      {row(leftCount,   'v', x0,      y0, H, true)}
      {row(rightCount,  'v', x0 + W,  y0, H, false)}
      <rect x={x0} y={y0} width={W} height={H} rx="4" fill={tc} stroke={tb} strokeWidth="2.5" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={tb} fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  )
}

function RectangleTable({ capacity, tc, tb, sc, label }: { capacity: number; tc: string; tb: string; sc: string; label: string }) {
  const seats  = Math.max(1, Math.min(capacity, 14))
  const W = 56, H = 30
  const x0 = 22, y0 = 35
  const cx = x0 + W / 2, cy = y0 + H / 2
  const seatW = 7, seatH = 5, gap = 5

  // Allocate seats: long sides get most, end caps get 1 each if >8
  const endCaps = seats > 8 ? 1 : 0
  const longSeats = seats - endCaps * 2
  const top    = Math.ceil(longSeats / 2)
  const bottom = Math.floor(longSeats / 2)

  function longRow(count: number, yPos: number, above: boolean): React.ReactNode[] {
    if (count <= 0) return []
    const spacing = W / count
    return Array.from({ length: count }, (_, i) => {
      const tx = x0 + spacing * (i + 0.5)
      const ty = above ? yPos - gap - seatH : yPos + gap
      return <rect key={`lr${above}${i}`} x={tx - seatW / 2} y={ty} width={seatW} height={seatH} rx="2" fill={sc} stroke={tb} strokeWidth="1.5" />
    })
  }

  function endCap(left: boolean): React.ReactNode {
    const ex = left ? x0 - gap - seatH : x0 + W + gap
    const ey = cy - seatW / 2
    return <rect key={`ec${left}`} x={ex} y={ey} width={seatH} height={seatW} rx="2" fill={sc} stroke={tb} strokeWidth="1.5" />
  }

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      {longRow(top, y0, true)}
      {longRow(bottom, y0 + H, false)}
      {endCaps > 0 && endCap(true)}
      {endCaps > 0 && endCap(false)}
      <rect x={x0} y={y0} width={W} height={H} rx="4" fill={tc} stroke={tb} strokeWidth="2.5" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={tb} fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  )
}

function TableShapeIcon({ shape, status, capacity, tableNumber }: {
  shape: TableShape
  status: TableStatus
  capacity: number
  tableNumber: number
}) {
  const s = STATUS[status]
  const label = String(tableNumber)
  const props = { capacity, tc: s.tableColor, tb: s.tableBorder, sc: s.seatColor, label }
  if (shape === 'round')     return <RoundTable {...props} />
  if (shape === 'rectangle') return <RectangleTable {...props} />
  return <SquareTable {...props} />
}

// ── Table card ───────────────��─────────────────────────────────
function TableCard({
  table, loading, manageMode, onClick, onEdit, onDelete,
}: {
  table: Table & { shape?: string }
  loading: boolean
  manageMode: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const meta = STATUS[table.status]
  const shape = (table.shape ?? 'square') as TableShape

  return (
    <div className={`relative rounded-2xl border-2 bg-white transition-all duration-200 select-none
      ${manageMode ? 'border-brand-300 bg-brand-50/40' : meta.card}
      ${loading ? 'opacity-60' : ''}
    `}>

      {/* Manage-mode action buttons */}
      {manageMode && (
        <div className="absolute -top-2 -right-2 flex gap-1 z-10">
          <button onClick={onEdit}
            className="w-7 h-7 rounded-full bg-white border border-ink/10 shadow-sm flex items-center justify-center text-ink-muted hover:text-ink transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={onDelete}
            className="w-7 h-7 rounded-full bg-white border border-red-200 shadow-sm flex items-center justify-center text-red-400 hover:text-red-600 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      )}

      <button
        onClick={manageMode ? onEdit : onClick}
        disabled={loading}
        className="w-full p-2 text-left cursor-pointer active:scale-95 transition-transform disabled:cursor-wait"
      >
        {/* Shape illustration */}
        <div className="w-full aspect-square flex items-center justify-center p-1">
          <TableShapeIcon
            shape={shape}
            status={table.status}
            capacity={table.capacity ?? 4}
            tableNumber={table.number}
          />
        </div>

        {/* Info row */}
        <div className="px-1.5 pb-1.5">
          {/* Label */}
          {table.label && (
            <p className="text-[10px] text-ink-faint truncate text-center mb-1">{table.label}</p>
          )}

          {/* Capacity + status */}
          <div className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-0.5 text-[10px] text-ink-faint">
              <Users size={9} />
              {table.capacity ?? 4}
            </span>
            {!manageMode ? (
              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${meta.badge}`}>
                {meta.label}
              </span>
            ) : (
              <span className="text-[9px] text-brand-500 font-medium">edit</span>
            )}
          </div>
        </div>

        {/* Status pulse dot (free only) */}
        {!manageMode && table.status === 'free' && (
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70">
            <Loader2 size={22} className="animate-spin text-brand-500" />
          </div>
        )}
      </button>
    </div>
  )
}

// ── Add / Edit modal ─────────────────���─────────────────────────
const SHAPE_OPTIONS: { value: TableShape; label: string; desc: string }[] = [
  { value: 'square',    label: 'Square',    desc: '2–4 seats' },
  { value: 'rectangle', label: 'Rectangle', desc: '4–8 seats' },
  { value: 'round',     label: 'Round',     desc: 'Any size' },
]

function TableModal({ table, sections, onClose, onSaved }: {
  table?: Table & { shape?: string }
  sections: Section[]
  onClose: () => void
  onSaved: () => void
}) {
  const [number,    setNumber]    = useState(table?.number?.toString() ?? '')
  const [label,     setLabel]     = useState(table?.label ?? '')
  const [capacity,  setCapacity]  = useState(table?.capacity?.toString() ?? '4')
  const [shape,     setShape]     = useState<TableShape>((table?.shape as TableShape) ?? 'square')
  const [sectionId, setSectionId] = useState<string>(
    table?.section_id?.toString() ?? sections[0]?.id?.toString() ?? ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!number || isNaN(Number(number))) return toast.error('Enter a valid table number')
    setSaving(true)
    try {
      const body = {
        number:     Number(number),
        label:      label.trim() || null,
        capacity:   Number(capacity) || 4,
        shape,
        section_id: Number(sectionId),
      }
      const res = table
        ? await fetch(`/api/pos/tables/${table.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/pos/tables',              { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

  const previewCap = Math.max(1, Number(capacity) || 4)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/5 sticky top-0 bg-white">
          <h2 className="font-display font-semibold text-ink">
            {table ? `Edit Table ${table.number}` : 'Add Table'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* Shape picker + live preview side by side */}
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-2">Table shape</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {SHAPE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setShape(o.value)}
                  className={`rounded-xl border-2 p-2.5 text-center transition-colors ${
                    shape === o.value
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-ink/10 hover:border-ink/20'
                  }`}
                >
                  <p className="text-xs font-semibold text-ink">{o.label}</p>
                  <p className="text-[10px] text-ink-faint mt-0.5">{o.desc}</p>
                </button>
              ))}
            </div>

            {/* Live preview */}
            <div className="flex justify-center">
              <div className="w-28 h-28 bg-surface-overlay rounded-xl p-1">
                <TableShapeIcon
                  shape={shape}
                  status="free"
                  capacity={previewCap}
                  tableNumber={Number(number) || 1}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              <label className="text-xs font-medium text-ink-muted block mb-1.5">Seats</label>
              <input
                type="number"
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                min={1} max={14}
                className="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1.5">
              Label <span className="text-ink-faint font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Window seat, Corner"
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

        <div className="flex gap-3 px-5 pb-5 sticky bottom-0 bg-white border-t border-ink/5 pt-4">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-ink/10 px-4 py-2.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-xl bg-ink text-surface px-4 py-2.5 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : table ? 'Save changes' : 'Add table'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Legend ──────────────────��──────────────────────────────────
function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-4">
      {(Object.entries(STATUS) as [TableStatus, typeof STATUS[TableStatus]][]).map(([, m]) => (
        <span key={m.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={`w-2 h-2 rounded-full ${m.dot}`} />
          {m.label}
        </span>
      ))}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────
export default function PosTablesClient({ bySection }: Props) {
  const router = useRouter()
  const [opening,      setOpening]      = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<number | 'all'>('all')
  const [manageMode,   setManageMode]   = useState(false)
  const [editingTable, setEditingTable] = useState<(Table & { shape?: string }) | null | undefined>(undefined)
  const [addToSection, setAddToSection] = useState<Section | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)

  const allSections = bySection.map(({ section }) => section)
  const allTables   = bySection.flatMap(({ tables }) => tables)
  const counts: Record<TableStatus, number> = { free: 0, occupied: 0, kot_sent: 0, billed: 0 }
  allTables.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1 })

  async function selectTable(table: Table) {
    setOpening(table.id)
    try {
      if (table.status === 'free') {
        router.push(`/pos/order/new?tableId=${table.id}`)
      } else {
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

  return (
    <div className="min-h-screen bg-surface">

      {/* Top bar */}
      <div className="bg-white border-b border-ink/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors">
              <ArrowLeft size={15} /> Dashboard
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
            <button
              onClick={() => setManageMode(m => !m)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                manageMode
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-surface-overlay text-ink-muted hover:text-ink border border-ink/10'
              }`}
            >
              <Settings size={14} />
              {manageMode ? 'Done' : 'Manage tables'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {manageMode && (
          <div className="mb-5 px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-700 flex items-center gap-2">
            <Settings size={14} className="shrink-0" />
            Tap a table to edit shape, seats, or label. Use <span className="font-semibold mx-0.5">+ Add table</span> to create new ones.
          </div>
        )}

        {/* Section tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveSection('all')}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              activeSection === 'all'
                ? 'bg-ink text-surface shadow-sm'
                : 'bg-white border border-ink/10 text-ink-muted hover:text-ink'
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
                  : 'bg-white border border-ink/10 text-ink-muted hover:text-ink'
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

        {/* Sections + tables */}
        <div className="space-y-8">
          {visibleSections.map(({ section, tables }) => (
            <div key={section.id}>
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

              {tables.length === 0 && !manageMode && (
                <p className="text-sm text-ink-faint py-4">No tables in this section.</p>
              )}

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {tables.map(table => (
                  <TableCard
                    key={table.id}
                    table={table as Table & { shape?: string }}
                    loading={opening === table.id || deletingId === table.id}
                    manageMode={manageMode}
                    onClick={() => selectTable(table)}
                    onEdit={() => { setAddToSection(null); setEditingTable(table as Table & { shape?: string }) }}
                    onDelete={() => deleteTable(table)}
                  />
                ))}

                {manageMode && (
                  <button
                    onClick={() => { setAddToSection(section); setEditingTable(null) }}
                    className="rounded-2xl border-2 border-dashed border-brand-300 text-center text-brand-400 hover:bg-brand-50 hover:text-brand-600 transition-colors aspect-square flex flex-col items-center justify-center gap-2"
                  >
                    <Plus size={22} />
                    <span className="text-xs font-medium">Add table</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!manageMode && (
          <div className="mt-8 pt-6 border-t border-ink/5">
            <StatusLegend />
          </div>
        )}
      </div>

      {editingTable !== undefined && (
        <TableModal
          table={editingTable ?? undefined}
          sections={addToSection ? [addToSection, ...allSections.filter(s => s.id !== addToSection.id)] : allSections}
          onClose={() => { setEditingTable(undefined); setAddToSection(null) }}
          onSaved={() => { setEditingTable(undefined); setAddToSection(null); router.refresh() }}
        />
      )}
    </div>
  )
}
