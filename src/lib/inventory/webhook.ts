// Outbound integration with the standalone TBC Inventory system.
//
// The POS stays the system of record for orders; the inventory service is the
// system of record for stock. On KOT-send and order-cancel the POS enqueues an
// event into `inventory_webhook_outbox` (in the same DB transaction as the
// state change) and a background flusher delivers it. Stock deduction therefore
// never sits in the KOT request path - a slow or offline inventory service can
// never delay a kitchen ticket.
//
// Entirely inert until INVENTORY_WEBHOOK_URL is set: enqueue returns early, the
// flusher does nothing, the outbox table stays empty.

import type postgres from 'postgres'
import { logger } from '@/lib/logger'
import { DEMO_CAFE_ID } from '@/lib/constants'

// `import type` only - a value import of getDb here would create a require cycle
// with lib/db/index.ts (which arms the flusher). flush() pulls getDb in lazily.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = postgres.TransactionSql<any>

export type InventoryWebhookEvent = 'pos-kot' | 'pos-cancel'

const MAX_ATTEMPTS = 10
const BATCH_SIZE = 25
const REQUEST_TIMEOUT_MS = Number(process.env.INVENTORY_WEBHOOK_TIMEOUT_MS ?? 8000)

function config() {
  const url = process.env.INVENTORY_WEBHOOK_URL?.trim().replace(/\/$/, '')
  const secret = process.env.INVENTORY_WEBHOOK_SECRET?.trim()
  return { url, secret, enabled: Boolean(url) }
}

export function inventoryWebhookEnabled(): boolean {
  return config().enabled
}

// ─── Enqueue ───────────────────────────────────────────────────────────────
// `exec` is the active transaction (or getDb()). The row lands atomically with
// the caller's own writes, so a rolled-back KOT never leaves a phantom event.
export async function enqueueInventoryWebhook(
  exec: Sql,
  eventType: InventoryWebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!config().enabled) return
  try {
    await exec`
      INSERT INTO inventory_webhook_outbox (event_type, payload)
      VALUES (${eventType}, ${exec.json({ cafe_id: DEMO_CAFE_ID, ...payload }) as never})
    `
  } catch (err) {
    // Never let an integration bookkeeping failure break KOT / cancel.
    logger.error('inventory.webhook.enqueue_failed', {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Delivery ──────────────────────────────────────────────────────────────
async function deliver(eventType: string, payload: unknown): Promise<{ ok: boolean; detail: string }> {
  const { url, secret } = config()
  if (!url) return { ok: false, detail: 'INVENTORY_WEBHOOK_URL not set' }

  const target = `${url}/api/webhooks/${eventType}${secret ? `?token=${encodeURIComponent(secret)}` : ''}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    const body = await res.text()
    if (res.ok) return { ok: true, detail: `${res.status}` }
    return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 300)}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

let flushing = false

export async function flushInventoryWebhookOutbox(): Promise<void> {
  if (!config().enabled || flushing) return
  flushing = true
  try {
    const { getDb } = await import('@/lib/db')
    const sql = getDb()
    // Backoff between retries: 30s, 60s, 120s, ... capped at 15 min.
    const rows = await sql<
      { id: string; event_type: string; payload: unknown; attempts: number }[]
    >`
      SELECT id, event_type, payload, attempts
      FROM inventory_webhook_outbox
      WHERE status = 'pending'
        AND attempts < ${MAX_ATTEMPTS}
        AND (last_attempt_at IS NULL
             OR last_attempt_at < now() - (least(30 * power(2, greatest(attempts - 1, 0)), 900)
                                           * interval '1 second'))
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
    `

    for (const row of rows) {
      const { ok, detail } = await deliver(row.event_type, row.payload)
      if (ok) {
        await sql`
          UPDATE inventory_webhook_outbox
          SET status = 'delivered', delivered_at = now(),
              attempts = attempts + 1, last_attempt_at = now(), last_error = NULL
          WHERE id = ${row.id}
        `
      } else {
        const nextStatus = row.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending'
        await sql`
          UPDATE inventory_webhook_outbox
          SET status = ${nextStatus}, attempts = attempts + 1,
              last_attempt_at = now(), last_error = ${detail}
          WHERE id = ${row.id}
        `
        logger.warn('inventory.webhook.delivery_failed', {
          id: row.id, eventType: row.event_type, attempt: row.attempts + 1, nextStatus, detail,
        })
      }
    }
  } catch (err) {
    logger.error('inventory.webhook.flush_error', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    flushing = false
  }
}

// Fire-and-forget nudge, called right after a KOT / cancel response so delivery
// is near-immediate instead of waiting for the interval tick.
export function kickInventoryWebhookFlush(): void {
  if (!config().enabled) return
  void flushInventoryWebhookOutbox()
}

// ─── Background flusher (mirrors lib/payment/scheduler.ts) ──────────────────
let started = false

export function startInventoryWebhookFlusherOnce(): void {
  if (started) return
  if (!config().enabled) return
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  started = true

  const intervalMs = Number(process.env.INVENTORY_WEBHOOK_INTERVAL_MS ?? 30_000)
  const timer = setInterval(() => {
    void flushInventoryWebhookOutbox()
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('inventory.webhook.flusher_scheduled', { intervalMs })
}
