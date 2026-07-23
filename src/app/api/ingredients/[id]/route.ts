import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import type { Ingredient } from '@/lib/types'

type IngredientPatch = Partial<
  Pick<Ingredient, 'name' | 'unit' | 'low_stock_threshold' | 'cost_per_unit_paisa' | 'is_perishable' | 'expiry_date'>
>

// PATCH /api/ingredients/[id] — edit ingredient metadata (name, unit,
// thresholds, cost, perishability, expiry). `current_stock` is deliberately
// NOT editable here — it only ever changes through a stock_transactions entry
// (see POST .../stock) so there's always an audit trail (Module 1).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const updateData: IngredientPatch = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.unit !== undefined) updateData.unit = body.unit
    if (body.low_stock_threshold !== undefined) updateData.low_stock_threshold = Number(body.low_stock_threshold)
    if (body.cost_per_unit_paisa !== undefined) updateData.cost_per_unit_paisa = Number(body.cost_per_unit_paisa)
    if (body.is_perishable !== undefined) updateData.is_perishable = Boolean(body.is_perishable)
    if (body.expiry_date !== undefined) updateData.expiry_date = body.expiry_date

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ data: null, error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ingredients')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update ingredient'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/ingredients/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('ingredients').delete().eq('id', params.id)

  if (error) {
    // FK violation — ingredient is still used in a recipe
    const status = error.code === '23503' ? 409 : 500
    const message =
      error.code === '23503'
        ? 'This ingredient is used in one or more recipes — remove it from those recipes first'
        : error.message
    return NextResponse.json({ data: null, error: message }, { status })
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
