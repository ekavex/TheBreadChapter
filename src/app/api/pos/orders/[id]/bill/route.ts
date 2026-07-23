import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { rupeesToPaisa } from '@/lib/money'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { CafeSettings } from '@/lib/types'

// POST /api/pos/orders/[id]/bill — Module 5 "Bill Generation & Printing":
// itemised total, table → billed. Safe to re-generate while still BILLED
// (e.g. a network retry) — recomputes from current order_items either way.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, items:order_items(*), table:tables(*)')
      .eq('id', params.id)
      .single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (!['KOT_SENT', 'BILLED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot bill an order that is ${order.pos_status}` }, { status: 409 })
    }

    const subtotal = (order.items ?? []).reduce((sum, i) => sum + i.subtotal, 0)

    const { data: cafe } = await supabase.from('cafes').select('settings').eq('id', DEMO_CAFE_ID).single()
    const settings = cafe?.settings as CafeSettings | undefined
    const taxPercent = settings?.tax_percent ?? 0
    const serviceChargePercent = settings?.service_charge_percent ?? 0
    const taxAmount = Math.round(subtotal * taxPercent) / 100
    const serviceCharge = Math.round(subtotal * serviceChargePercent) / 100
    const totalAmount = subtotal + taxAmount + serviceCharge
    const totalPaisa = rupeesToPaisa(totalAmount)

    if (order.pos_status === 'KOT_SENT') {
      await supabase.from('tables').update({ status: 'billed' }).eq('id', order.table_id)
    }

    const now = new Date().toISOString()
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        subtotal,
        tax_amount: taxAmount,
        service_charge: serviceCharge,
        total_amount: totalAmount,
        total_paisa: totalPaisa,
        pos_status: 'BILLED',
        billed_at: now,
      })
      .eq('id', params.id)
      .select('*, items:order_items(*), table:tables(*)')
      .single()
    if (updateError) throw updateError

    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate bill'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
