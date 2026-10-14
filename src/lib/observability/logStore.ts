// Writes logs to the app_logs table (migration 013) for developers to query -
// see docs/LOGGING.md. Three sources share it: server events (every logger.*
// call, plus anything else printed with console.error, e.g. Next.js' own
// unhandled-error output), print-bridge / app logs uploaded by the Android
// phones, and errors reported by POS/dashboard browsers.
//
// Logging must never break or slow the thing being logged: server entries are
// buffered and inserted in batches off the request path, any failure is
// swallowed (it still went to stdout), and the buffer is capped.
import { redactPaymentPayload } from '@/lib/observability/redact'

export type LogSource = 'server' | 'device' | 'browser'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  loggedAt?: Date | string | number
  source: LogSource
  level: LogLevel
  event: string
  message?: string | null
  orderId?: string | null
  deviceId?: string | null
  appVersion?: string | null
  requestId?: string | null
  data?: Record<string, unknown> | null
}

const RETENTION_DAYS = 14
const FLUSH_INTERVAL_MS = 2_000
const MAX_BATCH = 200
const MAX_BUFFER = 2_000
const MAX_MESSAGE = 2_000
const MAX_DATA_CHARS = 8_000
const PRUNE_EVERY_MS = 60 * 60 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

// Secrets that could ride along in a message string (URLs with ?token=,
// "password": "...", Authorization headers).
const SECRET_PATTERNS: [RegExp, string][] = [
  [/([?&](?:token|key|secret|password)=)[^&\s"']+/gi, '$1[redacted]'],
  [/("?(?:password|pass|token|secret|security_?token|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, '$1[redacted]'],
]

export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((t, [re, sub]) => t.replace(re, sub), text)
}

interface Row {
  logged_at: Date
  source: LogSource
  level: LogLevel
  event: string
  message: string | null
  order_id: string | null
  device_id: string | null
  app_version: string | null
  request_id: string | null
  data: unknown
}

function toRow(e: LogEntry): Row {
  const at = e.loggedAt == null ? new Date() : new Date(e.loggedAt)
  // A phone with a wrong clock shouldn't put entries years away from now.
  const loggedAt = Number.isNaN(at.getTime()) || Math.abs(at.getTime() - Date.now()) > 30 * 86_400_000 ? new Date() : at

  let data: unknown = null
  if (e.data && Object.keys(e.data).length > 0) {
    const safe = redactPaymentPayload(e.data)
    const json = scrubSecrets(JSON.stringify(safe))
    data = json.length <= MAX_DATA_CHARS ? JSON.parse(json) : { truncated: true, preview: json.slice(0, MAX_DATA_CHARS) }
  }

  const clip = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null)
  return {
    logged_at: loggedAt,
    source: e.source,
    level: LEVELS.includes(e.level) ? e.level : 'info',
    event: (e.event || 'unknown').slice(0, 100),
    message: e.message ? scrubSecrets(String(e.message)).slice(0, MAX_MESSAGE) : null,
    order_id: e.orderId && UUID_RE.test(e.orderId) ? e.orderId : null,
    device_id: clip(e.deviceId, 100),
    app_version: clip(e.appVersion, 40),
    request_id: clip(e.requestId, 100),
    data,
  }
}

const isServerRuntime = () => typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge'

// The original console.error, so the store's own failures can be reported
// without being captured (and re-stored) by the console hook below.
let rawConsoleError: (...args: unknown[]) => void = (...args) => console.error(...args)

async function insertRows(rows: Row[]): Promise<void> {
  if (rows.length === 0) return
  // Imported lazily: db -> scheduler -> logger -> logStore would otherwise be
  // a load-time import cycle.
  const { getDb } = await import('@/lib/db')
  const sql = getDb()
  await sql`
    INSERT INTO app_logs ${sql(
      rows.map((r) => ({ ...r, data: r.data == null ? null : sql.json(r.data as never) })),
      'logged_at', 'source', 'level', 'event', 'message', 'order_id', 'device_id', 'app_version', 'request_id', 'data',
    )}
  `
  void pruneOldLogs(sql)
}

let lastPruneAt = 0
async function pruneOldLogs(sql: Awaited<ReturnType<typeof import('@/lib/db')['getDb']>>) {
  if (Date.now() - lastPruneAt < PRUNE_EVERY_MS) return
  lastPruneAt = Date.now()
  try {
    await sql`DELETE FROM app_logs WHERE received_at < now() - (${RETENTION_DAYS}::int * interval '1 day')`
  } catch (err) {
    rawConsoleError('[logStore] prune failed:', err instanceof Error ? err.message : err)
  }
}

// ── Buffered writes for server-side logging ──────────────────────────────────

const buffer: Row[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let droppedSinceLastFlush = 0

async function flush() {
  flushTimer = null
  if (flushing) { scheduleFlush(); return }
  flushing = true
  try {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, MAX_BATCH)
      try {
        await insertRows(batch)
      } catch (err) {
        // DB down or table missing: the line is already on stdout - drop it.
        rawConsoleError('[logStore] could not store logs:', err instanceof Error ? err.message : err)
        break
      }
    }
    if (droppedSinceLastFlush > 0) {
      const dropped = droppedSinceLastFlush
      droppedSinceLastFlush = 0
      buffer.push(toRow({ source: 'server', level: 'warn', event: 'log.dropped', message: `${dropped} log entries dropped (buffer full)` }))
    }
  } finally {
    flushing = false
  }
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(() => { void flush() }, FLUSH_INTERVAL_MS)
}

// Fire-and-forget: never throws, never waits on the database.
export function storeLog(entry: LogEntry): void {
  if (!isServerRuntime()) return
  try {
    if (buffer.length >= MAX_BUFFER) { droppedSinceLastFlush++; return }
    buffer.push(toRow(entry))
    scheduleFlush()
  } catch {
    // Never let logging throw into the caller.
  }
}

// For the upload endpoints: stores a batch now and reports success, so the
// phone / browser only deletes entries the database actually has.
export async function storeLogsNow(entries: LogEntry[]): Promise<number> {
  const rows = entries.map(toRow)
  await insertRows(rows)
  return rows.length
}

// ── Capture console.error (Next.js' own unhandled-error output, libraries) ──
//
// Next.js bundles each route separately, so this module can be loaded many
// times in one server process. The hook is therefore installed once per
// process (state on globalThis); every copy of the module just points it at
// its own storeLog. Without this, one error was stored once per loaded route.

interface ConsoleHookState {
  original: (...args: unknown[]) => void
  store: (entry: LogEntry) => void
  lastMessage: string
  lastAt: number
}
const HOOK_KEY = '__tbcConsoleErrorHook'

function hookConsoleError() {
  if (!isServerRuntime()) return
  const g = globalThis as unknown as Record<string, ConsoleHookState | undefined>
  const existing = g[HOOK_KEY]
  if (existing) {
    existing.store = storeLog
    rawConsoleError = existing.original
    return
  }

  const state: ConsoleHookState = {
    original: console.error.bind(console),
    store: storeLog,
    lastMessage: '',
    lastAt: 0,
  }
  g[HOOK_KEY] = state
  rawConsoleError = state.original

  console.error = (...args: unknown[]) => {
    state.original(...args)
    // Our own logger lines ({"ts":...}) are stored by the logger itself.
    if (typeof args[0] === 'string' && (args[0].startsWith('{"ts":') || args[0].startsWith('[logStore]'))) return
    try {
      const error = args.find((a): a is Error => a instanceof Error)
      const message = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeStringify(a)))
        .join(' ')
      // Next.js often prints the same error twice (summary + detail); keep one.
      const now = Date.now()
      if (message === state.lastMessage && now - state.lastAt < 2_000) return
      state.lastMessage = message
      state.lastAt = now
      state.store({
        source: 'server',
        level: 'error',
        event: 'console.error',
        message,
        data: error?.stack ? { stack: error.stack.split('\n').slice(0, 15).join('\n') } : null,
      })
    } catch {
      // ignore
    }
  }
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

hookConsoleError()
