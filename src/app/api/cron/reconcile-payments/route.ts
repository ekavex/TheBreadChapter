// POST /api/cron/reconcile-payments
//
// Manual / external trigger for the reconciliation sweep. The in-process timer
// (src/instrumentation.ts) covers the normal case; this endpoint exists so an
// operator can force a sweep, and so an external cron can own the schedule in
// a multi-instance deployment.
//
// Auth: CRON_SECRET as `Authorization: Bearer …` or `?token=…`, or an
// authenticated admin session.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import { reconcilePendingPayments } from '@/lib/payment/reconcile'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

function hasCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim()
  if (!expected) return false
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const query = new URL(req.url).searchParams.get('token')?.trim()
  return bearer === expected || query === expected
}

export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const adminGuard = await requireAdmin(req)
    if (adminGuard) return adminGuard
  }

  try {
    const summary = await reconcilePendingPayments()
    return NextResponse.json({ data: summary, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconciliation failed'
    logger.error('payment.reconcile.endpoint_error', { error: message })
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
