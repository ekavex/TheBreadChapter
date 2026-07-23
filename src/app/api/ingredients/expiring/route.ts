import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// Live operational data — never let Next.js's default GET route-handler
// caching serve a stale snapshot (see docs/SMART_CAFE_TRACKER.md, M4).
export const dynamic = 'force-dynamic'

// GET /api/ingredients/expiring?days=3 — Module 1 "Expiry Tracking"
// (Milk, Cheese, Vegetables, Cream, ... — generate expiry alerts).
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const days = Number(new URL(req.url).searchParams.get('days') ?? '3')
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', cutoff)
    .order('expiry_date', { ascending: true })

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [], error: null })
}
