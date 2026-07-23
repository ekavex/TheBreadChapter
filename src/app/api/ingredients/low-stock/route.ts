import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import type { Ingredient } from '@/lib/types'

// GET /api/ingredients/low-stock — Module 1 "Low Stock Alert"
// e.g. "Bread < 20 pieces" — notification generated.
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('ingredients').select('*').order('name', { ascending: true })

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })

  const lowStock = ((data ?? []) as Ingredient[]).filter((i) => i.current_stock <= i.low_stock_threshold)
  return NextResponse.json({ data: lowStock, error: null })
}
