import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import type { Ingredient } from '@/lib/types'

// GET /api/ingredients — list all ingredients, with low-stock/expiry flags
// computed server-side so the UI stays presentational.
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })

  const ingredients = (data ?? []) as Ingredient[]
  const withFlags = ingredients.map((i) => ({
    ...i,
    is_low_stock: i.current_stock <= i.low_stock_threshold,
    days_to_expiry: i.expiry_date
      ? Math.ceil((new Date(i.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null,
  }))

  return NextResponse.json({ data: withFlags, error: null })
}

// POST /api/ingredients — add a new ingredient (Module 1: "Add Ingredient")
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, unit, low_stock_threshold, cost_per_unit_paisa, is_perishable, expiry_date, current_stock } = body

    if (!name || !unit) {
      return NextResponse.json({ data: null, error: 'name and unit are required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ingredients')
      .insert({
        name,
        unit,
        current_stock: current_stock ?? 0,
        low_stock_threshold: low_stock_threshold ?? 0,
        cost_per_unit_paisa: cost_per_unit_paisa ?? 0,
        is_perishable: is_perishable ?? false,
        expiry_date: expiry_date ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create ingredient'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
