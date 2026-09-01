// Periodic payment reconciliation sweep.
//
// Next.js 14's instrumentation hook also compiles for the Edge runtime, which
// cannot bundle postgres.js - so the sweep is started from the Node-only
// database module instead (see lib/db/index.ts). Same effect: one timer per
// server process, started the first time the process talks to the database.
//
// Multi-instance deployments should set RECONCILER_DISABLED=true and drive
// POST /api/cron/reconcile-payments from a single external cron instead.

import { logger } from '@/lib/logger'

let started = false

export function startReconcilerOnce(): void {
  if (started) return
  if (process.env.RECONCILER_DISABLED === 'true') return
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  started = true

  const intervalMs = Number(process.env.RECONCILER_INTERVAL_MS ?? 60_000)
  let running = false

  const tick = async () => {
    if (running) return // never overlap sweeps
    running = true
    try {
      const { reconcilePendingPayments } = await import('@/lib/payment/reconcile')
      await reconcilePendingPayments()
    } catch (err) {
      logger.error('payment.reconcile.tick_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('payment.reconcile.scheduled', { intervalMs })
}
