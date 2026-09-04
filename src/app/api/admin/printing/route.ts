import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession, requireAdmin } from '@/lib/auth/requireDashboardSession'
import { getPrintOverview, getStuckPrintJobs, getPrintLogFeed, getOrderPrintSummaries } from '@/lib/printing'

export const dynamic = 'force-dynamic'

// GET /api/admin/printing - live data for the admin Printing page. Polled by
// the client every ~20s so a stuck/duplicate print shows up without a
// manual refresh.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const [overview, stuck, feed, flagged] = await Promise.all([
      getPrintOverview(),
      getStuckPrintJobs(),
      getPrintLogFeed(150),
      getOrderPrintSummaries(),
    ])
    return NextResponse.json({ data: { overview, stuck, feed, flagged }, error: null })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : 'Failed to load printing data' },
      { status: 500 },
    )
  }
}
