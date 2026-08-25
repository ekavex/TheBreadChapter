import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import { getPnLData } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

// GET /api/analytics/profit-loss?range=daily|weekly|monthly|yearly — Module 6.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireAdmin(req)
  if (sessionGuard) return sessionGuard

  const range = (new URL(req.url).searchParams.get('range') ?? 'monthly') as
    | 'daily' | 'weekly' | 'monthly' | 'yearly'
  const data = await getPnLData(range)
  return NextResponse.json({ data, error: null })
}
