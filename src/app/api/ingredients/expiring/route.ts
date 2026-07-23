import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// GET /api/ingredients/expiring?days=3 — Module 1 "Expiry Tracking"
// (Milk, Cheese, Vegetables, Cream, ... — generate expiry alerts).
export async function GET(req: NextRequest) {
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
