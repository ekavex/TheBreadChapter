// Shared finalization logic used by both the pay route (polling path) and the
// Pine Labs webhook (push path).
//
// Two P0 rules this file enforces:
//   1. ALL writes happen inside a single database transaction. A crash halfway
//      through must roll back completely — never leave an order that can never
//      reach PAID because a side-effect flag was already consumed.
//   2. The amount reported by Pine Labs is verified against the order total
//      before anything is marked PAID. A mismatch is never finalized.
//
// Idempotency: the claim is `orders.pos_status <> 'PAID'` inside the
// transaction (SELECT ... FOR UPDATE), so concurrent webhook + poll callers
// serialize and only the first one applies side-effects.

import { upsertCustomer } from '@/lib/customers'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { toStorableJson } from '@/lib/observability/redact'
import type { Order, Payment } from '@/lib/types'
import type { PaymentResult } from './types'

type Sql = ReturnType<typeof getDb>

// Card data / VPA never reach the database or the logs.
function toJson(v: unknown) { return toStorableJson(v) as never }

function mapPaymentMethod(mode?: string): 'card' | 'upi' | 'cash' | 'unpaid' {
  if (!mode) return 'unpaid'
  const m = mode.toUpperCase()
  if (m.includes('UPI'))  return 'upi'
  if (m.includes('CARD')) return 'card'
  if (m.includes('CASH')) return 'cash'
  return 'unpaid'
}

// Thrown when Pine Labs reports an approved amount that does not match the
// order total. The caller must NOT retry the charge — the payment needs manual
// verification against the Pine Labs settlement report.
export class PaymentAmountMismatchError extends Error {
  constructor(readonly orderId: string, readonly expectedPaisa: number, readonly reportedPaisa: number) {
    super(`Payment amount mismatch on order ${orderId}: expected ${expectedPaisa} paisa, Pine Labs reported ${reportedPaisa} paisa`)
    this.name = 'PaymentAmountMismatchError'
  }
}

export interface FinalizeResult {
  order:   Order
  payment: Payment
}

async function fetchOrderWithItems(exec: Sql, orderId: string): Promise<Order | null> {
  const [order] = await exec`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await exec`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order.table_id
    ? await exec`SELECT t.*, s.name AS section_name FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${order.table_id}`
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
  // ─── Amount verification runs FIRST, before any database work ────────────
  const expectedPaisa = Number(order.total_paisa ?? 0)
  const reportedPaisa = statusResult.amountPaisa
  if (typeof reportedPaisa === 'number' && expectedPaisa > 0 && reportedPaisa !== expectedPaisa) {
    logger.error('payment.finalize.amount_mismatch', {
      orderId: order.id,
      paymentId: payment.id,
      ptrid: statusResult.ptrid,
      expectedPaisa,
      reportedPaisa,
    })
    throw new PaymentAmountMismatchError(order.id, expectedPaisa, reportedPaisa)
  }

  const sql = getDb()
  const result = await sql.begin(async (tx) => {
    const exec = tx as unknown as Sql

    // Lock the order row — concurrent webhook + poll callers queue here.
    const [locked] = await exec`SELECT * FROM orders WHERE id = ${order.id} FOR UPDATE`
    if (!locked) throw new Error(`Order ${order.id} disappeared during finalization`)

    // Already finalized by whoever got the lock first — no side-effects.
    if (locked.pos_status === 'PAID') {
      logger.info('payment.finalize.already_paid', { orderId: order.id, paymentId: payment.id })
      const paidOrder = await fetchOrderWithItems(exec, order.id)
      const [existingPayment] = await exec`SELECT * FROM payments WHERE id = ${payment.id}`
      return {
        order: (paidOrder ?? order) as Order,
        payment: (existingPayment as Payment) ?? payment,
      }
    }

    const items = await exec`SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY created_at`

    // Stock deduction — one stock_transactions row per recipe ingredient line.
    // Guarded by `stock_deducted_at` so a re-run after a rolled-back attempt
    // cannot double-deduct, while a rollback correctly un-sets the flag too.
    if (!locked.stock_deducted_at) {
      for (const item of items as unknown as { menu_item_id: string; quantity: number; name: string }[]) {
        const [recipe] = await exec`SELECT * FROM recipes WHERE menu_item_id = ${item.menu_item_id}`
        if (!recipe) continue
        const lines = await exec`SELECT * FROM recipe_ingredients WHERE recipe_id = ${recipe.id}`
        for (const line of lines) {
          await exec`
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
      await exec`UPDATE orders SET stock_deducted_at = now() WHERE id = ${order.id}`
    }

    // Final bank references on the payment row
    const [approvedPayment] = await exec`
      UPDATE payments SET
        status        = 'approved',
        mode          = ${statusResult.mode ?? payment.mode ?? null},
        rrn           = ${statusResult.rrn ?? null},
        approval_code = ${statusResult.approvalCode ?? null},
        txn_log_id    = ${statusResult.txnLogId ?? null},
        raw_response  = ${exec.json(toJson(statusResult))}
      WHERE id = ${payment.id}
      RETURNING *
    `

    if (locked.table_id) {
      await exec`UPDATE tables SET status = 'free' WHERE id = ${locked.table_id}`
    }

    const customerId = await upsertCustomer(customerPhone, customerName, exec)

    const now = new Date().toISOString()
    const [paidOrder] = await exec`
      UPDATE orders SET
        pos_status     = 'PAID',
        payment_status = 'paid',
        payment_method = ${mapPaymentMethod(statusResult.mode ?? payment.mode ?? undefined)},
        status         = 'completed',
        completed_at   = ${now}
        ${customerId ? exec`, customer_id = ${customerId}` : exec``}
      WHERE id = ${order.id}
      RETURNING *
    `
    if (!paidOrder) throw new Error('Failed to mark order as PAID')

    const finalOrder = await fetchOrderWithItems(exec, order.id)

    return {
      order: (finalOrder ?? paidOrder) as unknown as Order,
      payment: (approvedPayment as Payment) ?? payment,
    }
  })

  logger.info('payment.finalize.success', {
    orderId:   order.id,
    paymentId: payment.id,
    ptrid:     statusResult.ptrid,
    amountPaisa: expectedPaisa,
  })

  return result as FinalizeResult
}
