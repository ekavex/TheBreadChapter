// Structured logging. Every Pine Labs call, KOT print and payment state change
// emits one JSON line so ops can grep stdout or ship it to an aggregator.
//
// Two production requirements are handled here rather than at 100 call sites:
//   • Correlation - every line carries the request id set by middleware, so a
//     single payment can be followed across pay → webhook → reconciler.
//   • Redaction - no card data, VPA or security token ever reaches the log,
//     whatever a caller passes in.

import { headers } from 'next/headers'
import { redactPaymentPayload } from '@/lib/observability/redact'

type LogLevel = 'info' | 'warn' | 'error'

export const REQUEST_ID_HEADER = 'x-request-id'

// Available inside route handlers and server components; absent in background
// timers (the reconciler), where there is no request to correlate with.
function currentRequestId(): string | undefined {
  try {
    return headers().get(REQUEST_ID_HEADER) ?? undefined
  } catch {
    return undefined
  }
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const requestId = currentRequestId()
  const safeFields = redactPaymentPayload(fields) as Record<string, unknown>
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(requestId ? { requestId } : {}),
    ...safeFields,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
}
