import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/recipes?menuItemId=xxx — fetch the recipe (with ingredient lines)
// for a menu item, or { data: null } if it doesn't have one yet.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const menuItemId = new URL(req.url).searchParams.get('menuItemId')
  if (!menuItemId) {
    return NextResponse.json({ data: null, error: 'menuItemId is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('recipes')
    .select('*, ingredients:recipe_ingredients(*, ingredient:ingredients(*))')
    .eq('menu_item_id', menuItemId)
    .maybeSingle()

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}

// POST /api/recipes — Module 2: attach a recipe (ingredient + quantity lines)
// to a menu item. Recipe cost is never stored here — a DB trigger recomputes
// menu_items.cost_price_paisa the moment the lines are inserted.
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const menuItemId: string = body.menu_item_id
    const lines: { ingredient_id: string; quantity: number }[] = body.lines ?? []

    if (!menuItemId) {
      return NextResponse.json({ data: null, error: 'menu_item_id is required' }, { status: 400 })
    }
    if (lines.length === 0) {
      return NextResponse.json({ data: null, error: 'At least one ingredient line is required' }, { status: 400 })
    }
    if (lines.some((l) => !l.ingredient_id || !(Number(l.quantity) > 0))) {
      return NextResponse.json({ data: null, error: 'Every line needs an ingredient and a positive quantity' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .insert({ menu_item_id: menuItemId })
      .select()
      .single()

    if (recipeError) throw recipeError

    const { error: linesError } = await supabase.from('recipe_ingredients').insert(
      lines.map((l) => ({ recipe_id: recipe.id, ingredient_id: l.ingredient_id, quantity: Number(l.quantity) }))
    )
    if (linesError) throw linesError

    const { data: menuItem } = await supabase.from('menu_items').select('*').eq('id', menuItemId).single()
    return NextResponse.json({ data: { recipe, menuItem }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
