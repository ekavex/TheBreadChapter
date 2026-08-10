import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import type { Ingredient } from '@/lib/types'

type IngredientPatch = Partial<
  Pick<Ingredient, 'name' | 'unit' | 'low_stock_threshold' | 'cost_per_unit_paisa' | 'is_perishable' | 'expiry_date'>
>

// PATCH /api/ingredients/[id] — edit ingredient metadata (name, unit,
// thresholds, cost, perishability, expiry). `current_stock` is deliberately
// NOT editable here — it only ever changes through a stock_transactions entry
// (see POST .../stock) so there's always an audit trail (Module 1).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

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

    const sql = getDb()
    const [data] = await sql`UPDATE ingredients SET ${sql(updateData as Record<string, unknown>)} WHERE id = ${params.id} RETURNING *`

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update ingredient'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/ingredients/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    await sql`DELETE FROM ingredients WHERE id = ${params.id}`
    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const code = (err as { code?: string }).code
    // FK violation — ingredient is still used in a recipe
    if (code === '23503') {
      return NextResponse.json(
        { data: null, error: 'This ingredient is used in one or more recipes — remove it from those recipes first' },
        { status: 409 }
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to delete ingredient'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
