'use client'
import { useEffect } from 'react'

// Reports problems seen in the browser (POS, dashboard, the Android app's
// WebView) to /api/logs/client, where they land in app_logs for developers:
//   - uncaught JS errors and unhandled promise rejections;
//   - every /api call that fails: 5xx (with the server's error message - most
//     API routes return their error without logging it on the server), 4xx
//     refusals (e.g. "Order is already BILLED"), and network failures.
// Reports are batched, sent every few seconds and on page hide, and never
// interfere with the page: every step is wrapped and failures are ignored.

const ENDPOINT = '/api/logs/client'
const FLUSH_MS = 5_000
const MAX_QUEUE = 100
const DEVICE_KEY = 'tbc_device_id'
// Expected and frequent - not worth a log line.
const IGNORED_STATUSES = new Set([401])

type Entry = {
  ts: number
  level: 'warn' | 'error'
  event: string
  message: string
  orderId?: string
  data?: Record<string, unknown>
}

const UUID_IN_PATH = /\/(?:orders?|order)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function orderIdFrom(...paths: (string | undefined)[]): string | undefined {
  for (const p of paths) {
    const m = p?.match(UUID_IN_PATH)
    if (m) return m[1]
  }
  return undefined
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = `web-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'web-unknown'
  }
}

let installed = false

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const queue: Entry[] = []
  const id = deviceId()
  const originalFetch = window.fetch.bind(window)
  let timer: ReturnType<typeof setTimeout> | null = null

  const body = (entries: Entry[]) => JSON.stringify({ deviceId: id, entries })

  function flush(useBeacon = false) {
    timer = null
    if (queue.length === 0) return
    const batch = queue.splice(0, 50)
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, body(batch))
        return
      }
      originalFetch(ENDPOINT, { method: 'POST', body: body(batch), keepalive: true, headers: { 'Content-Type': 'application/json' } })
        .then((r) => { if (!r.ok && r.status >= 500) requeue(batch) })
        .catch(() => requeue(batch)) // offline: try again with the next batch
    } catch {
      // ignore
    }
    if (queue.length > 0) schedule()
  }

  function requeue(batch: Entry[]) {
    queue.unshift(...batch.slice(0, MAX_QUEUE - queue.length))
    schedule()
  }

  function schedule() {
    if (!timer) timer = setTimeout(() => flush(), FLUSH_MS)
  }

  function report(entry: Omit<Entry, 'ts'>) {
    try {
      if (queue.length >= MAX_QUEUE) return
      queue.push({ ts: Date.now(), ...entry, data: { page: location.pathname, ...entry.data } })
      schedule()
    } catch {
      // ignore
    }
  }

  window.addEventListener('error', (e) => {
    report({
      level: 'error',
      event: 'browser.error',
      message: e.message || 'Script error',
      orderId: orderIdFrom(location.pathname),
      data: { source: e.filename, line: e.lineno, column: e.colno, stack: e.error?.stack?.split('\n').slice(0, 10).join('\n') },
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    report({
      level: 'error',
      event: 'browser.unhandled_rejection',
      message: reason instanceof Error ? reason.message : String(reason),
      orderId: orderIdFrom(location.pathname),
      data: reason instanceof Error && reason.stack ? { stack: reason.stack.split('\n').slice(0, 10).join('\n') } : undefined,
    })
  })

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let path = url
    try { path = new URL(url, location.href).pathname } catch { /* keep url */ }
    const isApi = path.startsWith('/api/') && !path.startsWith('/api/logs/')

    let response: Response
    try {
      response = await originalFetch(input, init)
    } catch (err) {
      if (isApi) {
        report({
          level: 'error',
          event: 'api.network_error',
          message: `${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
          orderId: orderIdFrom(path, location.pathname),
          data: { method, path, online: navigator.onLine },
        })
      }
      throw err
    }

    if (isApi && response.status >= 400 && !IGNORED_STATUSES.has(response.status)) {
      // Read the server's error message from a copy, without consuming the
      // response the page is about to use.
      response.clone().json()
        .then((json: { error?: unknown }) => json?.error)
        .catch(() => undefined)
        .then((serverError) => {
          report({
            level: response.status >= 500 ? 'error' : 'warn',
            event: response.status >= 500 ? 'api.error' : 'api.rejected',
            message: `${method} ${path} -> ${response.status}${serverError ? `: ${String(serverError)}` : ''}`,
            orderId: orderIdFrom(path, location.pathname),
            data: { method, path, status: response.status },
          })
        })
    }
    return response
  }

  // Send what's queued when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
  window.addEventListener('pagehide', () => flush(true))
}

export default function ErrorReporter() {
  useEffect(() => { install() }, [])
  return null
}
