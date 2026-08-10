import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import type { StockTxnType } from '@/lib/types'

// POST /api/ingredients/[id]/stock — Module 1 "Update Stock":
// purchase entry, manual adjustment, expired stock removal. Every change
// goes through this ledger (stock_transactions) — a DB trigger applies it to
// ingredients.current_stock, so this route never writes current_stock directly.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json()
    const type = body.type as StockTxnType
    const rawQuantity = Number(body.quantity)
    const note: string | null = body.note ?? null
    const expiryDate: string | null = body.expiry_date ?? null

    if (!['purchase', 'manual_adjustment', 'expired_removal'].includes(type)) {
      return NextResponse.json({ data: null, error: 'Invalid stock transaction type' }, { status: 400 })
    }
    if (!Number.isFinite(rawQuantity) || rawQuantity === 0) {
      return NextResponse.json({ data: null, error: 'quantity must be a non-zero number' }, { status: 400 })
    }

    let signedQuantity: number
    if (type === 'purchase') {
      if (rawQuantity < 0) return NextResponse.json({ data: null, error: 'Purchase quantity must be positive' }, { status: 400 })
      signedQuantity = rawQuantity
    } else if (type === 'expired_removal') {
      if (rawQuantity < 0) return NextResponse.json({ data: null, error: 'Removal quantity must be positive' }, { status: 400 })
      signedQuantity = -rawQuantity
    } else {
      signedQuantity = rawQuantity // manual_adjustment — caller supplies the sign
    }

    const sql = getDb()
    const [txn] = await sql`
      INSERT INTO stock_transactions (ingredient_id, type, quantity, note)
      VALUES (${params.id}, ${type}, ${signedQuantity}, ${note})
      RETURNING *
    `

    // Purchasing a perishable item can move the nearest-upcoming-expiry date.
    // Simplification (see docs/IMPLEMENTATION_PLAN.md open item #4): one
    // expiry_date per ingredient, not full per-batch FIFO tracking.
    if (type === 'purchase' && expiryDate) {
      const [ingredient] = await sql`SELECT expiry_date FROM ingredients WHERE id = ${params.id}`
      const currentExpiry = ingredient?.expiry_date
      const shouldUpdate = !currentExpiry || new Date(expiryDate) < new Date(currentExpiry)
      if (shouldUpdate) {
        await sql`UPDATE ingredients SET expiry_date = ${expiryDate} WHERE id = ${params.id}`
      }
    }

    const [ingredient] = await sql`SELECT * FROM ingredients WHERE id = ${params.id}`

    return NextResponse.json({ data: { transaction: txn, ingredient }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to log stock transaction'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
