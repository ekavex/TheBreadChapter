// M9 — Observability. Every Pine Labs (payment) call and every KOT print goes
// through here as one structured JSON line, so ops can grep stdout or ship it
// to a log aggregator later without touching call sites again.
type LogLevel = 'info' | 'warn' | 'error'

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
}
