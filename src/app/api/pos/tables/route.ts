import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// POST /api/pos/tables — create a new table (manager only)
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { number, label, capacity, section_id, shape } = await req.json()
    if (!number || typeof number !== 'number') {
      return NextResponse.json({ data: null, error: 'Table number is required' }, { status: 400 })
    }
    if (!section_id) {
      return NextResponse.json({ data: null, error: 'Section is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tables')
      .insert({
        cafe_id: DEMO_CAFE_ID,
        number,
        label: label?.trim() || null,
        capacity: capacity ?? 4,
        shape: shape ?? 'square',
        section_id,
        is_active: true,
        status: 'free',
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ data: null, error: `Table ${number} already exists` }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ data, error: null }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to create table' }, { status: 500 })
  }
}

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
