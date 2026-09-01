// Append-only audit trail for everything that touches a payment.
//
// Answers the questions ops actually ask in production: what did Pine Labs
// tell us, when, through which channel, and what did we do about it.
// Also provides webhook de-duplication via a unique dedupe_key.

import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

export type PaymentEventSource = 'webhook' | 'poll' | 'reconciler' | 'cancel'

export interface PaymentEventInput {
  paymentId?: string | null
  orderId?: string | null
  source: PaymentEventSource
  ptrid?: string | null
  /** Unique per delivery - a repeated webhook with the same key is ignored. */
  dedupeKey?: string | null
  /** What the caller/postback claimed. */
  reported?: string | null
  /** What GetStatus actually confirmed. */
  verified?: string | null
  detail?: Record<string, unknown> | null
}

/**
 * Records an event. Returns false when the event was a duplicate (same
 * dedupeKey already stored), so the caller can skip repeated work.
 * Never throws - audit logging must not break payment handling.
 */
export async function recordPaymentEvent(input: PaymentEventInput): Promise<boolean> {
  try {
    const sql = getDb()
    const rows = await sql`
      INSERT INTO payment_events (payment_id, order_id, source, ptrid, dedupe_key, reported, verified, detail)
      VALUES (
        ${input.paymentId ?? null},
        ${input.orderId ?? null},
        ${input.source},
        ${input.ptrid ?? null},
        ${input.dedupeKey ?? null},
        ${input.reported ?? null},
        ${input.verified ?? null},
        ${input.detail ? sql.json(JSON.parse(JSON.stringify(input.detail))) : null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `
    return rows.length > 0
  } catch (err) {
    logger.warn('payment.event.write_failed', {
      source: input.source,
      orderId: input.orderId,
      error: err instanceof Error ? err.message : String(err),
    })
    return true
  }
}
