import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// Live operational data - never let Next.js's default GET route-handler
// caching serve a stale snapshot (see docs/SMART_CAFE_TRACKER.md, M4).
export const dynamic = 'force-dynamic'

// GET /api/ingredients/expiring?days=3 - Module 1 "Expiry Tracking"
// (Milk, Cheese, Vegetables, Cream, ... - generate expiry alerts).
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const days = Number(new URL(req.url).searchParams.get('days') ?? '3')
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const sql = getDb()
    const data = await sql`
      SELECT * FROM ingredients
      WHERE expiry_date IS NOT NULL AND expiry_date <= ${cutoff}
      ORDER BY expiry_date ASC
    `

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expiring ingredients'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
