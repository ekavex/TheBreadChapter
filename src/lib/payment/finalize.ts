// Shared finalization logic used by both the pay route (polling path) and the
// Pine Labs webhook (push path). Idempotent — concurrent calls are serialized
// by an atomic UPDATE claim on orders.stock_deducted_at.

import { upsertCustomer } from '@/lib/customers'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { Order, Payment } from '@/lib/types'
import type { PaymentResult } from './types'

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

async function fetchOrderWithItems(orderId: string): Promise<Order | null> {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order.table_id
    ? await sql`SELECT t.*, s.name AS section_name FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${order.table_id}`
    : [null]
  return {
    ...order,
    items,
    table: tableRow ? { ...tableRow, section: tableRow.section_name ? { name: tableRow.section_name } : null } : null,
  } as unknown as Order
}

export async function finalizeApprovedPayment(
  order:         Order,
  payment:       Payment,
  statusResult:  PaymentResult,
  customerPhone: string | null | undefined,
  customerName:  string | null | undefined,
): Promise<FinalizeResult> {
  const sql = getDb()

  // Early-out if already finalized by a concurrent caller
  const [freshOrderRow] = await sql`SELECT pos_status FROM orders WHERE id = ${order.id}`
  if (freshOrderRow?.pos_status === 'PAID') {
    const paidOrder = await fetchOrderWithItems(order.id)
    return { order: paidOrder ?? order, payment }
  }

  // Atomic claim — first writer wins; second writer bails without side-effects
  const claimed = await sql`
    UPDATE orders
    SET stock_deducted_at = ${new Date().toISOString()}
    WHERE id = ${order.id} AND stock_deducted_at IS NULL
    RETURNING id
  `

  if (!claimed.length) {
    logger.warn('payment.finalize.lost_race', { orderId: order.id, paymentId: payment.id })
    const currentOrder = await fetchOrderWithItems(order.id)
    return { order: currentOrder ?? order, payment }
  }

  // Stock deduction — one stock_transaction row per recipe ingredient line
  for (const item of order.items ?? []) {
    const [recipe] = await sql`SELECT * FROM recipes WHERE menu_item_id = ${item.menu_item_id}`
    if (!recipe) continue
    const lines = await sql`SELECT * FROM recipe_ingredients WHERE recipe_id = ${recipe.id}`
    for (const line of lines) {
      await sql`
        INSERT INTO stock_transactions (ingredient_id, type, quantity, reference_order_id, note)
        VALUES (
          ${line.ingredient_id},
          'sale_deduction',
          ${-(line.quantity * item.quantity)},
          ${order.id},
          ${`Order ${order.order_number} — ${item.name} x${item.quantity}`}
        )
      `
    }
  }

  // Update payment record with final bank references
  const [approvedPayment] = await sql`
    UPDATE payments SET
      status        = 'approved',
      mode          = ${statusResult.mode ?? payment.mode ?? null},
      rrn           = ${statusResult.rrn ?? null},
      approval_code = ${statusResult.approvalCode ?? null},
      txn_log_id    = ${statusResult.txnLogId ?? null},
      raw_response  = ${sql.json(toJson(statusResult))}
    WHERE id = ${payment.id}
    RETURNING *
  `

  // Release the table
  await sql`UPDATE tables SET status = 'free' WHERE id = ${order.table_id}`

  // Optional customer capture (phone entered at payment)
  const customerId = await upsertCustomer(customerPhone, customerName)

  const now = new Date().toISOString()
  const [paidOrder] = await sql`
    UPDATE orders SET
      pos_status     = 'PAID',
      payment_status = 'paid',
      payment_method = ${mapPaymentMethod(statusResult.mode ?? payment.mode ?? undefined)},
      status         = 'completed',
      completed_at   = ${now}
      ${customerId ? sql`, customer_id = ${customerId}` : sql``}
    WHERE id = ${order.id}
    RETURNING *
  `
  if (!paidOrder) throw new Error('Failed to mark order as PAID')

  const finalOrder = await fetchOrderWithItems(order.id)

  logger.info('payment.finalize.success', {
    orderId:   order.id,
    paymentId: payment.id,
    ptrid:     statusResult.ptrid,
  })

  return { order: (finalOrder ?? paidOrder) as Order, payment: (approvedPayment as Payment) ?? payment }
}
