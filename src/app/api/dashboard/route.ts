import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { getDashboardData } from '@/lib/dashboard'

export const dynamic = 'force-dynamic'

// GET /api/dashboard - Module 10 "Live Dashboard" tiles.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const data = await getDashboardData()
  return NextResponse.json({ data, error: null })
}
