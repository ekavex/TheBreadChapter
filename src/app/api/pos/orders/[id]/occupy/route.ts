import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// POST /api/pos/orders/[id]/occupy — manually mark the table as occupied
// Used when a waiter seats guests but hasn't added items yet.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const supabase = createAdminClient()

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('pos_status, table_id')
      .eq('id', params.id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    }
    if (order.pos_status !== 'OPEN') {
      return NextResponse.json({ data: null, error: 'Can only mark occupied for an open order' }, { status: 409 })
    }
    if (!order.table_id) {
      return NextResponse.json({ data: null, error: 'Order has no table' }, { status: 400 })
    }

    await supabase.from('tables').update({ status: 'occupied' }).eq('id', order.table_id)

    const { data: updatedOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*, items:order_items(*), table:tables(*, section:sections(*))')
      .eq('id', params.id)
      .single()
    if (fetchError) throw fetchError

    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to mark occupied' }, { status: 500 })
  }
}
