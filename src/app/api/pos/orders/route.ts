import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

// POST /api/pos/orders — Module 5 "Order Entry (POS)":
// waiter taps a table → if free, opens a new order and marks it occupied;
// if already occupied/kot_sent/billed, resumes the existing open order
// instead of creating a duplicate.
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { tableId } = await req.json()
    if (!tableId) return NextResponse.json({ data: null, error: 'tableId is required' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: table, error: tableError } = await supabase.from('tables').select('*').eq('id', tableId).single()
    if (tableError || !table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 })
    }

    if (table.status !== 'free') {
      const { data: existing, error: existingError } = await supabase
        .from('orders')
        .select('*, items:order_items(*), table:tables(*)')
        .eq('table_id', tableId)
        .not('pos_status', 'in', '(PAID,CANCELLED)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingError) throw existingError
      if (!existing) {
        return NextResponse.json(
          { data: null, error: `Table is marked ${table.status} but has no open order — data inconsistency, check manually` },
          { status: 409 }
        )
      }
      return NextResponse.json({ data: existing, error: null })
    }

    const { data: orderNumber, error: numberError } = await supabase.rpc('generate_order_number', { cafe_id: DEMO_CAFE_ID })
    if (numberError) throw numberError

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        cafe_id: DEMO_CAFE_ID,
        table_id: tableId,
        order_number: orderNumber,
        status: 'pending',
        pos_status: 'OPEN',
      })
      .select('*, items:order_items(*), table:tables(*)')
      .single()
    if (orderError) throw orderError

    const { error: tableUpdateError } = await supabase.from('tables').update({ status: 'occupied' }).eq('id', tableId)
    if (tableUpdateError) throw tableUpdateError

    return NextResponse.json({ data: order, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to open order'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
