import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

// DELETE /api/pos/orders/[id]/items/[itemId] — remove a line while still OPEN.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const supabase = createAdminClient()
  const { data: order, error: orderError } = await supabase.from('orders').select('pos_status').eq('id', params.id).single()
  if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
  if (order.pos_status !== 'OPEN') {
    return NextResponse.json({ data: null, error: `Items are locked — order is already ${order.pos_status}` }, { status: 409 })
  }

  const { error } = await supabase.from('order_items').delete().eq('id', params.itemId).eq('order_id', params.id)
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 })

  return NextResponse.json({ data: { ok: true }, error: null })
}
