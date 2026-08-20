// Payment reconciliation sweep (PINELABS_INTEGRATION_MASTER.md §12).
//
// Every order that is stuck in AWAITING_PAYMENT is money whose fate we do not
// know. Webhooks get lost, tablets get closed mid-payment, backends restart.
// This sweep is the backstop that guarantees every such order eventually
// reaches a terminal state without anybody pressing a button:
//
//   approved  → finalize (idempotent, transactional)
//   declined  → PAYMENT_FAILED
//   cancelled → PAYMENT_FAILED (table stays occupied; waiter may retry)
//   pending   → leave alone until AUTO_CANCEL has certainly elapsed, then
//               flag REQUIRES_VERIFICATION rather than guessing
//
// It never charges, never retries and never guesses: an order it cannot
// resolve is escalated to a human, not silently failed.

import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { paymentProvider } from './provider'
import { finalizeApprovedPayment, PaymentAmountMismatchError } from './finalize'
import { recordPaymentEvent } from './events'
import { toStorableJson } from '@/lib/observability/redact'
import { resolveStoreId } from '@/lib/payment/terminals'
import type { Order, Payment } from '@/lib/types'
import type { PaymentResult } from './types'

// Only look at orders that have been waiting longer than this — anything
// younger is probably still being paid in front of the customer.
export const RECONCILE_AFTER_MS = 90_000

// Pine Labs auto-cancels the open transaction after AUTO_CANCEL_MINUTES (5).
// Past this age a still-'pending' transaction is not going to settle on its
// own, so a human must confirm what happened on the terminal.
export const STALE_PENDING_MS = 12 * 60_000

const MAX_ORDERS_PER_SWEEP = 25

export interface ReconcileOutcome {
  orderId: string
  orderNumber: string | null
  result: 'paid' | 'failed' | 'cancelled' | 'still_pending' | 'requires_verification' | 'error'
  detail?: string
}

export interface ReconcileSummary {
  scanned: number
  outcomes: ReconcileOutcome[]
  startedAt: string
  durationMs: number
}

async function loadOrder(orderId: string): Promise<Order | null> {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  return { ...order, items } as unknown as Order
}

async function flagForVerification(orderId: string, reason: string) {
  const sql = getDb()
  await sql`
    UPDATE orders
    SET pos_status = 'REQUIRES_VERIFICATION', last_reconciled_at = now()
    WHERE id = ${orderId} AND pos_status = 'AWAITING_PAYMENT'
  `
  logger.error('payment.reconcile.requires_verification', { orderId, reason })
}

async function markFailed(orderId: string, payment: Payment, statusResult: PaymentResult) {
  const sql = getDb()
  await sql.begin(async (tx) => {
    await tx`
      UPDATE payments
      SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
          raw_response = ${tx.json(toStorableJson(statusResult) as never)}
      WHERE id = ${payment.id}
    `
    await tx`
      UPDATE orders
      SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed', last_reconciled_at = now()
      WHERE id = ${orderId} AND pos_status = 'AWAITING_PAYMENT'
    `
  })
}

async function reconcileOne(row: { id: string; order_number: string | null; updated_at: string }): Promise<ReconcileOutcome> {
  const sql = getDb()
  const orderId = row.id

  const [paymentRaw] = await sql`
    SELECT * FROM payments
    WHERE order_id = ${orderId}
    ORDER BY created_at DESC
    LIMIT 1
  `

  if (!paymentRaw) {
    await flagForVerification(orderId, 'no payment row for an order awaiting payment')
    return { orderId, orderNumber: row.order_number, result: 'requires_verification', detail: 'no payment row' }
  }
  const payment = paymentRaw as Payment

  if (!payment.plutus_ptrid) {
    // The upload never returned a reference: either it never reached Pine Labs
    // or the response was lost. A human must check the terminal.
    await flagForVerification(orderId, 'payment has no PTRID')
    return { orderId, orderNumber: row.order_number, result: 'requires_verification', detail: 'no ptrid' }
  }

  let statusResult: PaymentResult
  try {
    statusResult = await paymentProvider.status(payment.plutus_ptrid, {
      clientId: payment.client_id ?? '',
      storeId: payment.store_id ?? resolveStoreId(),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.warn('payment.reconcile.status_error', { orderId, ptrid: payment.plutus_ptrid, error: detail })
    await sql`UPDATE orders SET last_reconciled_at = now() WHERE id = ${orderId}`
    return { orderId, orderNumber: row.order_number, result: 'error', detail }
  }

  await recordPaymentEvent({
    paymentId: payment.id,
    orderId,
    source: 'reconciler',
    ptrid: payment.plutus_ptrid,
    verified: statusResult.status,
    detail: { responseStatus: statusResult.status },
  })

  if (statusResult.status === 'approved') {
    const order = await loadOrder(orderId)
    if (!order) return { orderId, orderNumber: row.order_number, result: 'error', detail: 'order vanished' }
    try {
      await finalizeApprovedPayment(order, payment, statusResult, null, null)
      logger.info('payment.reconcile.finalized', { orderId, ptrid: payment.plutus_ptrid })
      return { orderId, orderNumber: row.order_number, result: 'paid' }
    } catch (err) {
      if (err instanceof PaymentAmountMismatchError) {
        await flagForVerification(orderId, 'amount mismatch reported by Pine Labs')
        return { orderId, orderNumber: row.order_number, result: 'requires_verification', detail: 'amount mismatch' }
      }
      const detail = err instanceof Error ? err.message : String(err)
      logger.error('payment.reconcile.finalize_error', { orderId, error: detail })
      return { orderId, orderNumber: row.order_number, result: 'error', detail }
    }
  }

  if (statusResult.status === 'declined' || statusResult.status === 'cancelled') {
    await markFailed(orderId, payment, statusResult)
    logger.info('payment.reconcile.settled_failed', { orderId, status: statusResult.status })
    return { orderId, orderNumber: row.order_number, result: statusResult.status === 'cancelled' ? 'cancelled' : 'failed' }
  }

  // Still pending on the terminal.
  const ageMs = Date.now() - new Date(row.updated_at).getTime()
  if (ageMs > STALE_PENDING_MS) {
    await flagForVerification(orderId, `still pending after ${Math.round(ageMs / 60_000)} minutes`)
    return { orderId, orderNumber: row.order_number, result: 'requires_verification', detail: 'stale pending' }
  }

  await sql`UPDATE orders SET last_reconciled_at = now() WHERE id = ${orderId}`
  return { orderId, orderNumber: row.order_number, result: 'still_pending' }
}

export async function reconcilePendingPayments(): Promise<ReconcileSummary> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const sql = getDb()

  const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS).toISOString()
  const rows = (await sql`
    SELECT id, order_number, updated_at
    FROM orders
    WHERE pos_status = 'AWAITING_PAYMENT'
      AND updated_at < ${cutoff}
    ORDER BY updated_at ASC
    LIMIT ${MAX_ORDERS_PER_SWEEP}
  `) as unknown as { id: string; order_number: string | null; updated_at: string }[]

  const outcomes: ReconcileOutcome[] = []
  for (const row of rows) {
    try {
      outcomes.push(await reconcileOne(row))
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logger.error('payment.reconcile.unexpected', { orderId: row.id, error: detail })
      outcomes.push({ orderId: row.id, orderNumber: row.order_number, result: 'error', detail })
    }
  }

  const summary: ReconcileSummary = {
    scanned: rows.length,
    outcomes,
    startedAt,
    durationMs: Date.now() - t0,
  }

  if (rows.length > 0) {
    logger.info('payment.reconcile.sweep', {
      scanned: summary.scanned,
      paid: outcomes.filter((o) => o.result === 'paid').length,
      failed: outcomes.filter((o) => o.result === 'failed' || o.result === 'cancelled').length,
      needsVerification: outcomes.filter((o) => o.result === 'requires_verification').length,
      errors: outcomes.filter((o) => o.result === 'error').length,
      durationMs: summary.durationMs,
    })
  }

  return summary
}
