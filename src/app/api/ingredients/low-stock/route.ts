import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import type { Ingredient } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/ingredients/low-stock - Module 1 "Low Stock Alert"
// e.g. "Bread < 20 pieces" - notification generated.
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const data = await sql`SELECT * FROM ingredients ORDER BY name ASC`

    const lowStock = (data as unknown as Ingredient[]).filter((i) => i.current_stock <= i.low_stock_threshold)
    return NextResponse.json({ data: lowStock, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch low-stock ingredients'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
