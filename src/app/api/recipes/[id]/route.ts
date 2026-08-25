import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'

async function fetchRecipeWithDetails(recipeId: string) {
  const sql = getDb()
  const [recipe] = await sql`SELECT * FROM recipes WHERE id = ${recipeId}`
  if (!recipe) return null

  const ingredients = await sql`
    SELECT ri.id, ri.recipe_id, ri.ingredient_id, ri.quantity,
           i.id as i_id, i.name, i.unit, i.current_stock, i.low_stock_threshold,
           i.cost_per_unit_paisa, i.is_perishable, i.expiry_date, i.created_at as i_created_at
    FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = ${recipe.id}
  `
  const [menuItem] = await sql`SELECT * FROM menu_items WHERE id = ${recipe.menu_item_id}`

  return {
    ...recipe,
    menu_item: menuItem ?? null,
    ingredients: ingredients.map((r: any) => ({
      id: r.id, recipe_id: r.recipe_id, ingredient_id: r.ingredient_id, quantity: r.quantity,
      ingredient: {
        id: r.i_id, name: r.name, unit: r.unit, current_stock: r.current_stock,
        low_stock_threshold: r.low_stock_threshold, cost_per_unit_paisa: r.cost_per_unit_paisa,
        is_perishable: r.is_perishable, expiry_date: r.expiry_date, created_at: r.i_created_at,
      }
    }))
  }
}

// PATCH /api/recipes/[id] — replace a recipe's ingredient lines wholesale
// (simplest correct approach: delete then reinsert; the recompute trigger
// fires on each step but converges to the right final cost).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
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

    const sql = getDb()
    await sql`DELETE FROM recipe_ingredients WHERE recipe_id = ${params.id}`

    const lineRows = lines.map((l) => ({
      recipe_id: params.id,
      ingredient_id: l.ingredient_id,
      quantity: Number(l.quantity),
    }))
    await sql`INSERT INTO recipe_ingredients ${sql(lineRows)}`

    const recipe = await fetchRecipeWithDetails(params.id)
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
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [recipe] = await sql`SELECT menu_item_id FROM recipes WHERE id = ${params.id}`

    await sql`DELETE FROM recipes WHERE id = ${params.id}`

    if (recipe?.menu_item_id) {
      await sql`UPDATE menu_items SET cost_price_paisa = 0 WHERE id = ${recipe.menu_item_id}`
    }

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
