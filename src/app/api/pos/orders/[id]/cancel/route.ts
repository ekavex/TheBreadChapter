import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { DEMO_STORE_ID } from '@/lib/constants'

// POST /api/pos/orders/[id]/cancel — releases the table. Best-effort cancels
// any in-flight payment (per the state machine, only allowed before PIN entry
// on a real terminal — the mock never blocks this).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', params.id).single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (['PAID', 'CANCELLED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot cancel an order that is already ${order.pos_status}` }, { status: 409 })
    }

    const { data: latestPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestPayment?.plutus_ptrid && latestPayment.status === 'initiated') {
      try {
        await paymentProvider.cancel(latestPayment.plutus_ptrid, latestPayment.amount_paisa, {
          clientId: latestPayment.client_id ?? '',
          storeId: latestPayment.store_id ?? DEMO_STORE_ID,
        })
        await supabase.from('payments').update({ status: 'cancelled' }).eq('id', latestPayment.id)
      } catch {
        // best-effort — proceed with cancelling the order regardless
      }
    }

    await supabase.from('tables').update({ status: 'free' }).eq('id', order.table_id)

    const { data: cancelledOrder, error: updateError } = await supabase
      .from('orders')
      .update({ pos_status: 'CANCELLED', status: 'cancelled' })
      .eq('id', params.id)
      .select('*, items:order_items(*), table:tables(*)')
      .single()
    if (updateError) throw updateError

    return NextResponse.json({ data: cancelledOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel order'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
