// Shared finalization logic used by both the pay route (polling path) and the
// Pine Labs webhook (push path). The function is idempotent — concurrent calls
// for the same approved payment are serialized by an atomic UPDATE claim on
// orders.stock_deducted_at (see inline comment).

import { upsertCustomer } from '@/lib/customers'
import { logger } from '@/lib/logger'
import type { createAdminClient } from '@/lib/supabase/server'
import type { Order, Payment } from '@/lib/types'
import type { PaymentResult } from './types'

type Supabase = ReturnType<typeof createAdminClient>

const ORDER_WITH_ITEMS_AND_TABLE = '*, items:order_items(*), table:tables(*)'

// round-trip through JSON to coerce into a jsonb-compatible value
function toJson(v: unknown) { return JSON.parse(JSON.stringify(v)) }

function mapPaymentMethod(mode?: string): 'card' | 'upi' | 'cash' | 'unpaid' {
  if (!mode) return 'unpaid'
  const m = mode.toUpperCase()
  if (m.includes('UPI'))  return 'upi'
  if (m.includes('CARD')) return 'card'
  if (m.includes('CASH')) return 'cash'
  return 'unpaid'
}

export interface FinalizeResult {
  order:   Order
  payment: Payment
}

// Atomic claim via stock_deducted_at prevents double-stock-deduction when
// a webhook push + a poll race each other for the same approved PTRID.
export async function finalizeApprovedPayment(
  supabase:      Supabase,
  order:         Order,
  payment:       Payment,
  statusResult:  PaymentResult,
  customerPhone: string | null | undefined,
  customerName:  string | null | undefined,
): Promise<FinalizeResult> {

  // Early-out if already finalized by a concurrent caller
  const { data: freshOrder } = await supabase
    .from('orders').select('pos_status').eq('id', order.id).single()
  if (freshOrder?.pos_status === 'PAID') {
    const { data: paid } = await supabase
      .from('orders').select(ORDER_WITH_ITEMS_AND_TABLE).eq('id', order.id).single()
    return { order: paid as Order, payment }
  }

  // Atomic claim — first writer wins; second writer bails without side-effects
  const { data: claim } = await supabase
    .from('orders')
    .update({ stock_deducted_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('stock_deducted_at', null)
    .select('id')
    .maybeSingle()

  if (!claim) {
    logger.warn('payment.finalize.lost_race', { orderId: order.id, paymentId: payment.id })
    const { data: current } = await supabase
      .from('orders').select(ORDER_WITH_ITEMS_AND_TABLE).eq('id', order.id).single()
    return { order: (current as Order) ?? order, payment }
  }

  // Stock deduction — one stock_transaction row per recipe ingredient line
  for (const item of order.items ?? []) {
    const { data: recipe } = await supabase
      .from('recipes')
      .select('*, ingredients:recipe_ingredients(*)')
      .eq('menu_item_id', item.menu_item_id)
      .maybeSingle()
    if (!recipe) continue
    for (const line of recipe.ingredients ?? []) {
      await supabase.from('stock_transactions').insert({
        ingredient_id:      line.ingredient_id,
        type:               'sale_deduction',
        quantity:           -(line.quantity * item.quantity),
        reference_order_id: order.id,
        note: `Order ${order.order_number} — ${item.name} x${item.quantity}`,
      })
    }
  }

  // Update payment record with final bank references
  const { data: approvedPayment } = await supabase
    .from('payments')
    .update({
      status:        'approved',
      mode:          statusResult.mode          ?? payment.mode ?? null,
      rrn:           statusResult.rrn           ?? null,
      approval_code: statusResult.approvalCode  ?? null,
      txn_log_id:    statusResult.txnLogId      ?? null,
      raw_response:  toJson(statusResult),
    })
    .eq('id', payment.id)
    .select()
    .single()

  // Release the table
  await supabase.from('tables').update({ status: 'free' }).eq('id', order.table_id)

  // Optional customer capture (phone entered at payment)
  const customerId = await upsertCustomer(supabase, customerPhone, customerName)

  const now = new Date().toISOString()
  const { data: paidOrder, error } = await supabase
    .from('orders')
    .update({
      pos_status:      'PAID',
      payment_status:  'paid',
      payment_method:  mapPaymentMethod(statusResult.mode ?? payment.mode ?? undefined),
      status:          'completed',
      completed_at:    now,
      ...(customerId ? { customer_id: customerId } : {}),
    })
    .eq('id', order.id)
    .select(ORDER_WITH_ITEMS_AND_TABLE)
    .single()
  if (error) throw error

  logger.info('payment.finalize.success', {
    orderId:   order.id,
    paymentId: payment.id,
    ptrid:     statusResult.ptrid,
  })

  return { order: paidOrder as Order, payment: (approvedPayment as Payment) ?? payment }
}
