import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

// Table status changes constantly (waiter actions) — never let Next.js's
// default GET route-handler caching serve a stale snapshot.
export const dynamic = 'force-dynamic'

// GET /api/pos/tables — sections + tables with live status (Module 5:
// "Each table shows a live status — Free, Occupied, KOT Sent, or Billed").
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const supabase = createAdminClient()
  const [{ data: sections, error: sectionsError }, { data: tables, error: tablesError }] = await Promise.all([
    supabase.from('sections').select('*').order('sort_order', { ascending: true }),
    supabase
      .from('tables')
      .select('*')
      .eq('cafe_id', DEMO_CAFE_ID)
      .eq('is_active', true)
      .order('number', { ascending: true }),
  ])

  if (sectionsError) return NextResponse.json({ data: null, error: sectionsError.message }, { status: 500 })
  if (tablesError) return NextResponse.json({ data: null, error: tablesError.message }, { status: 500 })

  const bySection = (sections ?? []).map((section) => ({
    section,
    tables: (tables ?? []).filter((t) => t.section_id === section.id),
  }))

  return NextResponse.json({ data: bySection, error: null })
}
