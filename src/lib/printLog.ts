// Append-only audit trail for every KOT/bill print lifecycle event - queued,
// printed, skipped as a duplicate, or reclaimed as stale. Powers the admin
// Printing page. Mirrors src/lib/payment/events.ts: never throws, a logging
// failure must never break KOT/bill printing itself.

import type postgres from 'postgres'
import { logger } from '@/lib/logger'

type SqlClient = postgres.Sql<any> | postgres.TransactionSql<any>

export type PrintLogEvent = 'queued' | 'printed' | 'stale_reclaimed' | 'skipped_duplicate'

export interface PrintLogInput {
  orderId: string
  station: string
  jobType: string
  event: PrintLogEvent
  kotTicketId?: string | null
  detail?: string | null
  actor?: string | null
}

export async function recordPrintEvent(exec: SqlClient, input: PrintLogInput): Promise<void> {
  try {
    await exec`
      INSERT INTO print_log (kot_ticket_id, order_id, station, job_type, event, detail, actor)
      VALUES (
        ${input.kotTicketId ?? null},
        ${input.orderId},
        ${input.station},
        ${input.jobType},
        ${input.event},
        ${input.detail ?? null},
        ${input.actor ?? null}
      )
    `
  } catch (err) {
    logger.warn('print_log.write_failed', {
      event: input.event,
      orderId: input.orderId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// True when a Postgres error is "no unique/exclusion constraint matches the
// ON CONFLICT target" (42P10) - i.e. migration 010 hasn't applied on this
// instance yet. Never let that block printing: the exact same failure mode
// (a migration not yet applied when new code shipped) took down KOT sending
// in production once already - see commit 0fcd1b7's revert of the M3 webhook.
export function isMissingConflictTarget(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '42P10')
}
