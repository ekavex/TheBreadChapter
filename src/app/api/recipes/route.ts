import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/recipes?menuItemId=xxx — fetch the recipe (with ingredient lines)
// for a menu item, or { data: null } if it doesn't have one yet.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  const menuItemId = new URL(req.url).searchParams.get('menuItemId')
  if (!menuItemId) {
    return NextResponse.json({ data: null, error: 'menuItemId is required' }, { status: 400 })
  }

  try {
    const sql = getDb()
    const [recipe] = await sql`SELECT * FROM recipes WHERE menu_item_id = ${menuItemId}`
    if (!recipe) return NextResponse.json({ data: null, error: null })

    const ingredients = await sql`
      SELECT ri.id, ri.recipe_id, ri.ingredient_id, ri.quantity,
             i.id as i_id, i.name, i.unit, i.current_stock, i.low_stock_threshold,
             i.cost_per_unit_paisa, i.is_perishable, i.expiry_date, i.created_at as i_created_at
      FROM recipe_ingredients ri
      JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_id = ${recipe.id}
    `

    const data = {
      ...recipe,
      ingredients: ingredients.map((r: any) => ({
        id: r.id, recipe_id: r.recipe_id, ingredient_id: r.ingredient_id, quantity: r.quantity,
        ingredient: {
          id: r.i_id, name: r.name, unit: r.unit, current_stock: r.current_stock,
          low_stock_threshold: r.low_stock_threshold, cost_per_unit_paisa: r.cost_per_unit_paisa,
          is_perishable: r.is_perishable, expiry_date: r.expiry_date, created_at: r.i_created_at,
        }
      }))
    }

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// POST /api/recipes — Module 2: attach a recipe (ingredient + quantity lines)
// to a menu item. Recipe cost is never stored here — a DB trigger recomputes
// menu_items.cost_price_paisa the moment the lines are inserted.
export async function POST(req: NextRequest) {
  const sessionGuard = await requireManagerOrAdmin(req)
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

    const sql = getDb()
    const [recipe] = await sql`INSERT INTO recipes (menu_item_id) VALUES (${menuItemId}) RETURNING *`

    const lineRows = lines.map((l) => ({
      recipe_id: recipe.id,
      ingredient_id: l.ingredient_id,
      quantity: Number(l.quantity),
    }))
    await sql`INSERT INTO recipe_ingredients ${sql(lineRows)}`

    const [menuItem] = await sql`SELECT * FROM menu_items WHERE id = ${menuItemId}`
    return NextResponse.json({ data: { recipe, menuItem }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create recipe'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
