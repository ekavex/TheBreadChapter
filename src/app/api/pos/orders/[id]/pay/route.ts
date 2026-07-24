import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { DEMO_STORE_ID } from '@/lib/constants'
import { upsertCustomer } from '@/lib/customers'
import type { PaymentMethod } from '@/lib/types'

const ALLOWED_MODE_CODE: Record<'card' | 'cash' | 'upi', string> = { card: '1', cash: '2', upi: '10' }

// PaymentResult has no index signature, so it isn't structurally a Json value —
// round-trip through JSON to store it in the jsonb raw_response column.
function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function mapPaymentMethod(pineLabsMode?: string): PaymentMethod {
  if (!pineLabsMode) return 'unpaid'
  const m = pineLabsMode.toUpperCase()
  if (m.includes('UPI')) return 'upi'
  if (m.includes('CARD')) return 'card'
  if (m.includes('CASH')) return 'cash'
  return 'unpaid'
}

// POST /api/pos/orders/[id]/pay — Module 5 §9: UploadBilledTransaction (charge)
// then GetStatus (status) against the PaymentProvider abstraction. On approval:
// idempotent finalize — deduct ingredient stock per recipe, mark PAID, release
// the table. On decline: PAYMENT_FAILED, table stays billed so the waiter can retry.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { mode, customer_phone, customer_name } = await req.json()
    if (!['card', 'cash', 'upi'].includes(mode)) {
      return NextResponse.json({ data: null, error: 'mode must be "card", "cash" or "upi"' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, items:order_items(*), table:tables(*)')
      .eq('id', params.id)
      .single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (!['BILLED', 'PAYMENT_FAILED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot take payment on an order that is ${order.pos_status}` }, { status: 409 })
    }

    const { data: terminal } = await supabase.from('terminals').select('*').limit(1).maybeSingle()
    if (!terminal) return NextResponse.json({ data: null, error: 'No payment terminal configured' }, { status: 500 })

    const transactionNumber = `${order.order_number}-${Date.now()}`
    const chargeResult = await paymentProvider.charge({
      transactionNumber,
      amountPaisa: order.total_paisa,
      allowedModes: ALLOWED_MODE_CODE[mode as 'card' | 'cash' | 'upi'],
      clientId: terminal.client_id,
      storeId: DEMO_STORE_ID,
    })

    await supabase.from('orders').update({ pos_status: 'AWAITING_PAYMENT' }).eq('id', params.id)

    const { data: payment, error: paymentInsertError } = await supabase
      .from('payments')
      .insert({
        order_id: params.id,
        transaction_number: transactionNumber,
        plutus_ptrid: chargeResult.ptrid ?? null,
        status: 'initiated',
        mode: chargeResult.mode ?? null,
        amount_paisa: order.total_paisa,
        client_id: terminal.client_id,
        store_id: DEMO_STORE_ID,
        raw_response: toJson(chargeResult),
      })
      .select()
      .single()
    if (paymentInsertError) throw paymentInsertError

    const statusResult = chargeResult.ptrid
      ? await paymentProvider.status(chargeResult.ptrid, { clientId: terminal.client_id, storeId: DEMO_STORE_ID })
      : chargeResult

    if (statusResult.status === 'approved') {
      // Idempotency guard — only the PAID transition deducts stock/revenue.
      const { data: freshOrder } = await supabase.from('orders').select('pos_status').eq('id', params.id).single()
      if (freshOrder?.pos_status === 'PAID') {
        const { data: alreadyPaid } = await supabase
          .from('orders')
          .select('*, items:order_items(*), table:tables(*)')
          .eq('id', params.id)
          .single()
        return NextResponse.json({ data: { order: alreadyPaid, payment }, error: null })
      }

      for (const item of order.items ?? []) {
        const { data: recipe } = await supabase
          .from('recipes')
          .select('*, ingredients:recipe_ingredients(*)')
          .eq('menu_item_id', item.menu_item_id)
          .maybeSingle()

        if (!recipe) continue
        for (const line of recipe.ingredients ?? []) {
          await supabase.from('stock_transactions').insert({
            ingredient_id: line.ingredient_id,
            type: 'sale_deduction',
            quantity: -(line.quantity * item.quantity),
            reference_order_id: params.id,
            note: `Order ${order.order_number} — ${item.name} x${item.quantity}`,
          })
        }
      }

      const { data: approvedPayment } = await supabase
        .from('payments')
        .update({
          status: 'approved',
          mode: statusResult.mode ?? chargeResult.mode ?? null,
          rrn: statusResult.rrn ?? null,
          approval_code: statusResult.approvalCode ?? null,
          txn_log_id: statusResult.txnLogId ?? null,
          raw_response: toJson(statusResult),
        })
        .eq('id', payment.id)
        .select()
        .single()

      await supabase.from('tables').update({ status: 'free' }).eq('id', order.table_id)

      // Module 8: optional phone capture at payment (skippable for walk-ins).
      // Resolves-or-creates a customer row; FK on the order only if resolved.
      const customerId = await upsertCustomer(supabase, customer_phone, customer_name)

      const now = new Date().toISOString()
      const { data: paidOrder, error: paidError } = await supabase
        .from('orders')
        .update({
          pos_status: 'PAID',
          payment_status: 'paid',
          payment_method: mapPaymentMethod(statusResult.mode ?? chargeResult.mode),
          status: 'completed',
          completed_at: now,
          ...(customerId ? { customer_id: customerId } : {}),
        })
        .eq('id', params.id)
        .select('*, items:order_items(*), table:tables(*)')
        .single()
      if (paidError) throw paidError

      return NextResponse.json({ data: { order: paidOrder, payment: approvedPayment ?? payment }, error: null })
    }

    // declined / cancelled / pending-but-unresolved
    await supabase
      .from('payments')
      .update({ status: statusResult.status === 'cancelled' ? 'cancelled' : 'declined', raw_response: toJson(statusResult) })
      .eq('id', payment.id)

    const { data: failedOrder, error: failedError } = await supabase
      .from('orders')
      .update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' })
      .eq('id', params.id)
      .select('*, items:order_items(*), table:tables(*)')
      .single()
    if (failedError) throw failedError

    return NextResponse.json({ data: { order: failedOrder, payment: { ...payment, status: statusResult.status } }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
