import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { getAreaAnalytics } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

// GET /api/analytics/area?days=30 — Module 7.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const days = Number(new URL(req.url).searchParams.get('days') ?? '30')
  const data = await getAreaAnalytics(days)
  return NextResponse.json({ data, error: null })
}
