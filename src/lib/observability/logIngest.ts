// Shared validation for the log upload endpoints (/api/logs/device,
// /api/logs/client). Entries are untrusted input: only known fields are kept,
// sizes are capped, and logStore redacts secrets before anything is stored.
import type { LogEntry, LogLevel, LogSource } from './logStore'

export const MAX_ENTRIES_PER_UPLOAD = 500
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null)

export interface UploadContext {
  source: LogSource
  deviceId: string | null
  appVersion: string | null
  extra?: Record<string, unknown> // added to every entry's data (user, device model...)
}

export function parseUploadedEntries(raw: unknown, ctx: UploadContext): LogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_ENTRIES_PER_UPLOAD).flatMap((e): LogEntry[] => {
    if (!isObj(e)) return []
    const level = LEVELS.find((l) => l === e.level) ?? 'info'
    const data = isObj(e.data) ? e.data : {}
    return [{
      loggedAt: typeof e.ts === 'number' || typeof e.ts === 'string' ? e.ts : undefined,
      source: ctx.source,
      level,
      event: str(e.event, 100) ?? 'log',
      message: str(e.message, 2000),
      orderId: str(e.orderId, 60),
      deviceId: ctx.deviceId,
      appVersion: ctx.appVersion,
      data: ctx.extra || Object.keys(data).length ? { ...data, ...ctx.extra } : null,
    }]
  })
}

export function cleanId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(v) ? v : null
}
