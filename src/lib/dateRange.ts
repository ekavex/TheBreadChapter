// Custom date-window parsing shared by /dashboard/analytics, /dashboard/reports
// and their API routes. Dates travel as `YYYY-MM-DD` strings (`from`/`to` query
// params); a single-date selection is just from === to.
import { isValid, parseISO, startOfDay, endOfDay, differenceInCalendarDays, format } from 'date-fns'

// Upper bound on a custom window so one request can't pull every order ever.
export const MAX_RANGE_DAYS = 366

export interface DateWindow {
  from: Date
  to: Date
}

export type ParsedDateRange =
  | { ok: true; window: DateWindow; from: string; to: string }
  | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDay(value: string): Date | null {
  if (!DATE_RE.test(value)) return null
  // parseISO treats a bare date as local midnight (new Date() would use UTC),
  // matching the startOfDay/endOfDay convention used everywhere else.
  const d = parseISO(value)
  return isValid(d) ? d : null
}

// Returns null when no custom range was requested at all (caller falls back
// to its default window). `to` is optional: a lone `from` means that one day.
export function parseDateRange(
  fromParam: string | null | undefined,
  toParam: string | null | undefined,
): ParsedDateRange | null {
  const fromStr = fromParam?.trim() || ''
  const toStr = toParam?.trim() || fromStr
  if (!fromStr) return toParam?.trim() ? { ok: false, error: 'Start date is required' } : null

  const from = parseDay(fromStr)
  const to = parseDay(toStr)
  if (!from || !to) return { ok: false, error: 'Dates must be in YYYY-MM-DD format' }
  if (to < from) return { ok: false, error: 'End date must be on or after the start date' }
  if (differenceInCalendarDays(to, from) + 1 > MAX_RANGE_DAYS) {
    return { ok: false, error: `Date range can be at most ${MAX_RANGE_DAYS} days` }
  }

  return {
    ok: true,
    window: { from: startOfDay(from), to: endOfDay(to) },
    from: fromStr,
    to: toStr,
  }
}

export function formatWindowLabel(win: DateWindow): string {
  const fromLabel = format(win.from, 'd MMM yyyy')
  const toLabel = format(win.to, 'd MMM yyyy')
  return fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`
}
