'use client'
import { useEffect, useState } from 'react'
import { differenceInMinutes } from 'date-fns'
import { useKitchenOrders } from '@/lib/hooks/useKitchenOrders'
import type { Order, OrderStatus } from '@/lib/types'
import toast from 'react-hot-toast'
import { ArrowLeft, ChefHat, Clock, Wifi } from 'lucide-react'
import Link from 'next/link'

const STATUS_FLOW: Record<string, OrderStatus> = {
  pending:   'confirmed',
  confirmed: 'making',
  making:    'ready',
  ready:     'served',
}

const COLUMNS: {
  key: string
  label: string
  accent: string
  headerBg: string
  cardBorder: string
  btnClass: string
  btnLabel: string
  emptyText: string
}[] = [
  {
    key: 'pending',
    label: 'New Orders',
    accent: 'bg-emerald-500',
    headerBg: 'bg-emerald-500/10 border-emerald-500/20',
    cardBorder: 'border-emerald-500/40',
    btnClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    btnLabel: 'Accept',
    emptyText: 'No new orders',
  },
  {
    key: 'confirmed',
    label: 'Confirmed',
    accent: 'bg-sky-500',
    headerBg: 'bg-sky-500/10 border-sky-500/20',
    cardBorder: 'border-sky-500/30',
    btnClass: 'bg-sky-600 hover:bg-sky-500 text-white',
    btnLabel: 'Start Cooking',
    emptyText: 'Nothing confirmed yet',
  },
  {
    key: 'making',
    label: 'Cooking',
    accent: 'bg-amber-500',
    headerBg: 'bg-amber-500/10 border-amber-500/20',
    cardBorder: 'border-amber-500/40',
    btnClass: 'bg-amber-500 hover:bg-amber-400 text-black font-bold',
    btnLabel: 'Mark Ready',
    emptyText: 'Nothing cooking',
  },
  {
    key: 'ready',
    label: 'Ready',
    accent: 'bg-violet-500',
    headerBg: 'bg-violet-500/10 border-violet-500/20',
    cardBorder: 'border-violet-500/30',
    btnClass: 'bg-violet-600 hover:bg-violet-500 text-white',
    btnLabel: 'Mark Served',
    emptyText: 'Nothing ready yet',
  },
]

function LiveClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-sm text-slate-400 tabular-nums">
      {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

function Timer({ createdAt }: { createdAt: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const mins = differenceInMinutes(new Date(), new Date(createdAt))
  const cls = mins > 20 ? 'text-red-400' : mins > 10 ? 'text-amber-400' : 'text-emerald-400'
  return (
    <span className={`font-mono font-bold text-xl tabular-nums ${cls}`}>
      {mins}m
    </span>
  )
}

async function updateStatus(orderId: string, status: OrderStatus) {
  await fetch('/api/orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, status }),
  })
}

interface Props { cafeId: string }

export default function KitchenDisplay({ cafeId }: Props) {
  const { orders, loading } = useKitchenOrders(cafeId)

  const columns: Record<string, Order[]> = {
    pending:   orders.filter(o => o.status === 'pending'),
    confirmed: orders.filter(o => o.status === 'confirmed'),
    making:    orders.filter(o => o.status === 'making'),
    ready:     orders.filter(o => o.status === 'ready'),
  }
  const total = orders.length

  async function advance(order: Order) {
    const next = STATUS_FLOW[order.status]
    if (!next) return
    await updateStatus(order.id, next)
    toast.success(`${order.order_number} → ${next}`, { style: { background: '#1e293b', color: '#f1f5f9' } })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center gap-3">
        <ChefHat size={24} className="text-slate-500 animate-pulse" />
        <p className="text-slate-400 text-lg">Loading barista display…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-body">

      {/* ── Header ── */}
      <header className="flex items-center gap-4 px-5 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
          Dashboard
        </Link>

        <div className="h-4 w-px bg-slate-700" />

        <div className="flex items-center gap-2">
          <ChefHat size={18} className="text-amber-400" />
          <span className="font-display font-bold text-white">Barista Display</span>
          <span className="text-slate-600 text-sm">· The Bread Chapter</span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* Active order count */}
          <span className="text-xs text-slate-400">
            <span className="text-white font-semibold">{total}</span> active
          </span>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <Wifi size={13} className="text-emerald-500" />
          </div>

          <LiveClock />
        </div>
      </header>

      {/* ── Kanban ── */}
      <div className="flex-1 grid grid-cols-4 gap-3 p-4 overflow-hidden">
        {COLUMNS.map((col) => {
          const colOrders = columns[col.key] ?? []
          return (
            <div key={col.key} className="flex flex-col min-h-0">

              {/* Column header */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border mb-3 ${col.headerBg}`}>
                <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  {col.label}
                </span>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                  colOrders.length > 0 ? 'bg-white/10 text-white' : 'text-slate-600'
                }`}>
                  {colOrders.length}
                </span>
              </div>

              {/* Order cards */}
              <div className="space-y-3 overflow-y-auto flex-1 pr-0.5" style={{ scrollbarWidth: 'none' }}>
                {colOrders.length === 0 && (
                  <div className="border border-dashed border-slate-800 rounded-2xl p-6 text-center text-slate-700 text-sm">
                    {col.emptyText}
                  </div>
                )}

                {colOrders.map(order => (
                  <div
                    key={order.id}
                    className={`bg-slate-900 rounded-2xl border ${col.cardBorder} overflow-hidden`}
                  >
                    {/* KOT ticket top bar */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                      <div>
                        <p className="text-xs text-slate-500 font-mono leading-none mb-0.5">
                          {order.order_number}
                        </p>
                        <p className="text-white font-display font-bold text-base leading-tight">
                          {(order.table as { label?: string; number?: number })?.label
                            || `Table ${(order.table as { number?: number })?.number ?? '—'}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-slate-500">
                        <Clock size={11} />
                        <Timer createdAt={order.created_at} />
                      </div>
                    </div>

                    {/* Items */}
                    <div className="px-4 py-3 space-y-1.5">
                      {(order.items ?? []).map(item => (
                        <div key={item.id} className="flex items-start gap-2.5">
                          <span className="font-mono text-sm font-bold text-slate-300 w-6 text-right shrink-0 mt-0.5">
                            {item.quantity}×
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-100 text-sm leading-tight">{item.name}</span>
                            {item.customisation && (
                              <p className="text-xs text-amber-400 italic mt-0.5">{item.customisation}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Notes */}
                    {order.notes && (
                      <div className="mx-3 mb-3 text-xs text-amber-300 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                        {order.notes}
                      </div>
                    )}

                    {/* Action */}
                    {STATUS_FLOW[order.status] && (
                      <div className="px-3 pb-3">
                        <button
                          onClick={() => advance(order)}
                          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${col.btnClass}`}
                        >
                          {col.btnLabel}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
