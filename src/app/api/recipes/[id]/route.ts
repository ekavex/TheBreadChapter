import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// PATCH /api/recipes/[id] — replace a recipe's ingredient lines wholesale
// (simplest correct approach: delete then reinsert; the recompute trigger
// fires on each step but converges to the right final cost).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const lines: { ingredient_id: string; quantity: number }[] = body.lines ?? []

    if (lines.length === 0) {
      return NextResponse.json({ data: null, error: 'At least one ingredient line is required' }, { status: 400 })
    }
    if (lines.some((l) => !l.ingredient_id || !(Number(l.quantity) > 0))) {
      return NextResponse.json({ data: null, error: 'Every line needs an ingredient and a positive quantity' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error: deleteError } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', params.id)
    if (deleteError) throw deleteError

    const { error: insertError } = await supabase.from('recipe_ingredients').insert(
      lines.map((l) => ({ recipe_id: params.id, ingredient_id: l.ingredient_id, quantity: Number(l.quantity) }))
    )
    if (insertError) throw insertError

    const { data: recipe, error: fetchError } = await supabase
      .from('recipes')
      .select('*, ingredients:recipe_ingredients(*, ingredient:ingredients(*)), menu_item:menu_items(*)')
      .eq('id', params.id)
      .single()
    if (fetchError) throw fetchError

    return NextResponse.json({ data: recipe, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// DELETE /api/recipes/[id] — remove the recipe entirely (recipe_ingredients
// cascade; the menu item's cost_price_paisa recompute trigger only fires on
// recipe_ingredients changes, so we zero the cost explicitly here too).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const supabase = createAdminClient()
    const { data: recipe } = await supabase.from('recipes').select('menu_item_id').eq('id', params.id).maybeSingle()

    const { error } = await supabase.from('recipes').delete().eq('id', params.id)
    if (error) throw error

    if (recipe?.menu_item_id) {
      await supabase.from('menu_items').update({ cost_price_paisa: 0 }).eq('id', recipe.menu_item_id)
    }

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
