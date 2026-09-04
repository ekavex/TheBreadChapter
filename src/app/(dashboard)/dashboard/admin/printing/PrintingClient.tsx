'use client'
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, CheckCircle2, Printer, RefreshCw } from 'lucide-react'
import type { PrintOverview, StuckPrintJob, PrintLogRow, OrderPrintSummary } from '@/lib/printing'

const POLL_MS = 20_000

interface PrintingData {
  overview: PrintOverview
  stuck: StuckPrintJob[]
  feed: PrintLogRow[]
  flagged: OrderPrintSummary[]
}

const EVENT_STYLE: Record<string, { label: string; className: string }> = {
  queued:            { label: 'Queued',            className: 'bg-blue-50 text-blue-700 border-blue-200' },
  printed:           { label: 'Printed',           className: 'bg-green-50 text-green-700 border-green-200' },
  skipped_duplicate: { label: 'Duplicate blocked', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  stale_reclaimed:   { label: 'Stale reclaim',     className: 'bg-red-50 text-red-600 border-red-200' },
}

const JOB_LABEL: Record<string, string> = { kot: 'KOT', bill_qr: 'Bill' }

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ${seconds % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

function EventBadge({ event }: { event: string }) {
  const style = EVENT_STYLE[event] ?? { label: event, className: 'bg-surface-overlay text-ink-muted border-ink/10' }
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${style.className}`}>
      {style.label}
    </span>
  )
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneClass = tone === 'bad' ? 'text-status-overdue' : tone === 'warn' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="bg-surface-overlay rounded-xl p-3">
      <p className="text-[10px] text-ink-faint uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-display font-bold mt-0.5 ${toneClass}`}>{value}</p>
    </div>
  )
}

export default function PrintingClient({ initial }: { initial: PrintingData }) {
  const [data, setData] = useState<PrintingData>(initial)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(false)

  async function refresh() {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/printing', { cache: 'no-store' })
      const json = await res.json()
      if (!json.error && json.data) {
        setData(json.data)
        setLastUpdated(new Date())
      }
    } catch {
      // Silent - next poll retries; this is a monitoring page, not a critical action.
    } finally {
      setRefreshing(false)
      inFlight.current = false
    }
  }

  useEffect(() => {
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const { overview, stuck, feed, flagged } = data

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
            <Printer size={22} className="text-ink-faint" /> Printing
          </h1>
          <p className="text-ink-muted text-sm mt-0.5">
            KOT &amp; bill print activity, duplicates prevented, and anything stuck
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink px-2.5 py-1.5 rounded-lg hover:bg-surface-overlay transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Updated {format(lastUpdated, 'h:mm:ss a')}
        </button>
      </div>

      {/* Overview tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Printed today" value={overview.printedToday} />
        <Tile label="Printed (7d)" value={overview.printedLast7Days} />
        <Tile label="Duplicates blocked (7d)" value={overview.duplicatesPreventedLast7Days} tone={overview.duplicatesPreventedLast7Days > 0 ? 'warn' : undefined} />
        <Tile label="Stale reclaims (7d)" value={overview.staleReclaimsLast7Days} tone={overview.staleReclaimsLast7Days > 0 ? 'warn' : undefined} />
        <Tile label="Stuck right now" value={overview.stuckNow} tone={overview.stuckNow > 0 ? 'bad' : 'ok'} />
      </div>

      {/* Needs attention: stuck jobs */}
      <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
        <h2 className="font-display font-semibold text-ink mb-1 flex items-center gap-2">
          {stuck.length > 0
            ? <AlertTriangle size={16} className="text-status-overdue" />
            : <CheckCircle2 size={16} className="text-green-600" />}
          Needs attention
        </h2>
        <p className="text-xs text-ink-faint mb-4">
          Queued or claimed for over 3 minutes with no print confirmation - check the bridge device and printer.
        </p>
        {stuck.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing stuck. All recent jobs confirmed printed.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint border-b border-ink/5">
                  <th className="pb-2 pr-3">Order</th>
                  <th className="pb-2 pr-3">Table</th>
                  <th className="pb-2 pr-3">Station</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Stuck for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {stuck.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2 pr-3 font-medium text-ink">{j.orderNumber ?? j.orderId.slice(0, 8)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{j.tableLabel ?? '-'}</td>
                    <td className="py-2 pr-3 text-ink-muted capitalize">{j.station.replace('_', ' ')}</td>
                    <td className="py-2 pr-3 text-ink-muted">{JOB_LABEL[j.jobType] ?? j.jobType}</td>
                    <td className="py-2 pr-3 text-ink-muted capitalize">{j.printStatus}</td>
                    <td className="py-2 pr-3 font-medium text-status-overdue tabular-nums">{formatAge(j.ageSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Orders with repeat / duplicate prints */}
      <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
        <h2 className="font-display font-semibold text-ink mb-1">Repeat &amp; duplicate prints</h2>
        <p className="text-xs text-ink-faint mb-4">
          Orders that printed more than once, had a duplicate attempt blocked, or had a stale reclaim - last {' '}
          7 days.
        </p>
        {flagged.length === 0 ? (
          <p className="text-sm text-ink-muted">No repeats or duplicates in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint border-b border-ink/5">
                  <th className="pb-2 pr-3">Order</th>
                  <th className="pb-2 pr-3">Table</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Printed</th>
                  <th className="pb-2 pr-3">Duplicates blocked</th>
                  <th className="pb-2 pr-3">Stale reclaims</th>
                  <th className="pb-2 pr-3">Last event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {flagged.map((f) => (
                  <tr key={`${f.orderId}-${f.jobType}`}>
                    <td className="py-2 pr-3 font-medium text-ink">
                      {f.orderNumber ?? f.orderId.slice(0, 8)}
                      {f.currentlyStuck && (
                        <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">
                          STUCK
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{f.tableLabel ?? '-'}</td>
                    <td className="py-2 pr-3 text-ink-muted">{JOB_LABEL[f.jobType] ?? f.jobType}</td>
                    <td className={`py-2 pr-3 font-medium tabular-nums ${f.printedCount > 1 ? 'text-status-overdue' : 'text-ink'}`}>
                      {f.printedCount}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-amber-600">{f.duplicatesPreventedCount || '-'}</td>
                    <td className="py-2 pr-3 tabular-nums text-amber-600">{f.staleReclaimedCount || '-'}</td>
                    <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">{format(new Date(f.lastEventAt), 'd MMM, h:mm a')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent activity feed */}
      <div className="bg-surface-raised rounded-2xl border border-ink/5 p-5">
        <h2 className="font-display font-semibold text-ink mb-4">Recent activity</h2>
        {feed.length === 0 ? (
          <p className="text-sm text-ink-muted">No print activity yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5 max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-raised">
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint border-b border-ink/5">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Order</th>
                  <th className="pb-2 pr-3">Table</th>
                  <th className="pb-2 pr-3">Station</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Event</th>
                  <th className="pb-2 pr-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {feed.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 text-ink-muted whitespace-nowrap tabular-nums">{format(new Date(row.createdAt), 'd MMM, h:mm:ss a')}</td>
                    <td className="py-2 pr-3 font-medium text-ink">{row.orderNumber ?? row.orderId.slice(0, 8)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{row.tableLabel ?? '-'}</td>
                    <td className="py-2 pr-3 text-ink-muted capitalize">{row.station.replace('_', ' ')}</td>
                    <td className="py-2 pr-3 text-ink-muted">{JOB_LABEL[row.jobType] ?? row.jobType}</td>
                    <td className="py-2 pr-3"><EventBadge event={row.event} /></td>
                    <td className="py-2 pr-3 text-ink-muted">{row.actor ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
