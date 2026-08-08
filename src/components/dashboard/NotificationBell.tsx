'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AppNotification, NotificationSeverity } from '@/app/api/notifications/route'

const STORAGE_KEY = 'tbc_notif_seen'
const POLL_MS = 60_000

function severityIcon(s: NotificationSeverity) {
  if (s === 'critical') return <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
  if (s === 'warning')  return <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
  return <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
}

interface Props {
  /** Which side of the bell button the panel should open toward */
  side?: 'left' | 'right'
}

export default function NotificationBell({ side = 'right' }: Props) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // panel position (fixed, computed on open)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const seenRef = useRef<Set<string>>(new Set())
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Load previously-seen IDs from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) seenRef.current = new Set(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  function persistSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seenRef.current)))
    } catch { /* ignore */ }
  }

  const fetchNotifications = useCallback(async (showToasts = false) => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const { data } = await res.json()
      if (!Array.isArray(data)) return
      const notifs = data as AppNotification[]
      setNotifications(notifs)

      if (showToasts) {
        const unseen = notifs.filter(n => !seenRef.current.has(n.id) && n.severity !== 'info')
        unseen.slice(0, 3).forEach((n, i) => {
          setTimeout(() => {
            if (n.severity === 'critical') {
              toast.error(n.title, { duration: 6000, id: n.id })
            } else {
              toast(n.title, {
                icon: '⚠️',
                duration: 5000,
                id: n.id,
                style: { background: '#fffbeb', color: '#92400e' },
              })
            }
          }, i * 800)
        })
      }
    } catch { /* ignore */ }
  }, [])

  // Initial fetch + poll
  useEffect(() => {
    setLoading(true)
    fetchNotifications(true).finally(() => setLoading(false))
    const interval = setInterval(() => fetchNotifications(false), POLL_MS)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Recompute panel position whenever open changes
  useEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const PANEL_W = Math.min(320, window.innerWidth - 16)
    const top = rect.bottom + 8

    let left: number
    if (side === 'left') {
      // Panel opens rightward from button's left edge
      left = rect.left
      // Clamp so panel doesn't go off right edge
      left = Math.min(left, window.innerWidth - PANEL_W - 8)
    } else {
      // Panel opens leftward from button's right edge
      left = rect.right - PANEL_W
      // Clamp so panel doesn't go off left edge
      left = Math.max(left, 8)
    }

    setPanelStyle({ position: 'fixed', top, left, width: PANEL_W, zIndex: 9999 })
  }, [open, side])

  function openPanel() {
    setOpen(o => !o)
  }

  function markAllRead() {
    notifications.forEach(n => seenRef.current.add(n.id))
    persistSeen()
    setNotifications(prev => [...prev])
  }

  function handleNotifClick(n: AppNotification) {
    seenRef.current.add(n.id)
    persistSeen()
    setOpen(false)
    if (n.href) router.push(n.href)
  }

  const unseenCount = notifications.filter(n => !seenRef.current.has(n.id)).length
  const criticalCount = notifications.filter(n => n.severity === 'critical').length

  return (
    <>
      {/* ── Bell button ── */}
      <button
        ref={btnRef}
        onClick={openPanel}
        className="relative p-2 rounded-xl text-ink-muted hover:bg-surface-overlay transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} className={criticalCount > 0 ? 'text-red-500' : 'text-ink-muted'} />

        {/* Unseen count badge */}
        {unseenCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center bg-red-500">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}

        {/* All-seen green dot */}
        {unseenCount === 0 && notifications.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* ── Dropdown panel (fixed, computed position) ── */}
      {open && (
        <div
          ref={panelRef}
          style={panelStyle}
          className="bg-white rounded-2xl border border-ink/10 shadow-2xl flex flex-col overflow-hidden max-h-[480px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink/5 shrink-0">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-ink-muted" />
              <span className="font-display font-semibold text-sm text-ink">Notifications</span>
              {notifications.length > 0 && (
                <span className="text-[10px] font-bold text-ink-faint bg-surface-overlay px-1.5 py-0.5 rounded-full">
                  {notifications.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {unseenCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] font-medium text-brand-600 hover:text-brand-700"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-0.5 rounded-lg text-ink-muted hover:text-ink">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-ink-faint">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                  <Bell size={18} className="text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-ink">All clear!</p>
                <p className="text-xs text-ink-faint mt-0.5">No alerts right now</p>
              </div>
            ) : (
              <div className="divide-y divide-ink/5">
                {notifications.map(n => {
                  const unseen = !seenRef.current.has(n.id)
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-surface-overlay/60 transition-colors ${unseen ? 'bg-surface-overlay/30' : ''}`}
                    >
                      {severityIcon(n.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <p className={`text-xs font-semibold leading-snug ${
                            n.severity === 'critical' ? 'text-red-700' :
                            n.severity === 'warning'  ? 'text-amber-700' :
                            'text-ink'
                          }`}>
                            {n.title}
                          </p>
                          {unseen && (
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0 mt-1" />
                          )}
                        </div>
                        <p className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">{n.body}</p>
                      </div>
                      {n.href && <ChevronRight size={12} className="text-ink-faint shrink-0 mt-0.5" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-ink/5 px-4 py-2.5 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-ink-faint">
                {criticalCount > 0
                  ? `${criticalCount} critical · needs attention`
                  : 'All non-critical'}
              </span>
              <button
                onClick={() => { setOpen(false); router.push('/dashboard/inventory') }}
                className="text-[10px] font-medium text-brand-600 hover:text-brand-700"
              >
                View inventory →
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
