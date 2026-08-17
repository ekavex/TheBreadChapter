import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/provider'
import { finalizeApprovedPayment, PaymentAmountMismatchError } from '@/lib/payment/finalize'
import { resolveStoreId, selectTerminalForSection, sectionIdForOrder, NoTerminalConfiguredError } from '@/lib/payment/terminals'
import { logger } from '@/lib/logger'
import { recordPaymentEvent } from '@/lib/payment/events'
import { toStorableJson } from '@/lib/observability/redact'
import type { Order, Payment, Terminal } from '@/lib/types'
import type { PaymentResult } from '@/lib/payment/types'

const ALLOWED_MODE_CODE: Record<'card' | 'cash' | 'upi', string> = { card: '1', cash: '2', upi: '10' }

// How long a single HTTP request waits for the terminal before handing the
// order back to the client as AWAITING_PAYMENT. The customer is tapping a card
// or scanning a QR during this window; ~25s covers the common case while
// staying well under any proxy timeout.
const POLL_TIMEOUT_MS  = 25_000
const POLL_INTERVAL_MS = 2_000

// Payment state reported to the UI. Deliberately distinguishes "we do not know"
// from "it failed" — a frontend timeout is NOT a failed payment.
export type PaymentState =
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'pending'                // terminal still has the transaction open
  | 'requires_verification'  // ambiguous — a human must check before any retry

// Card data / VPA never reach the database or the logs.
function toJson(value: unknown) { return toStorableJson(value) as never }

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }

function ok(order: Order | null, payment: Payment | null, state: PaymentState, message?: string) {
  return NextResponse.json({ data: { order, payment, paymentState: state, message: message ?? null }, error: null })
}

// An ambiguous outcome is persisted, not just reported: the order must stay
// visibly un-settled for the reconciler, the dashboard and the next shift.
async function flagRequiresVerification(orderId: string, reason: string) {
  const sql = getDb()
  const rows = await sql`
    UPDATE orders
    SET pos_status = 'REQUIRES_VERIFICATION'
    WHERE id = ${orderId} AND pos_status IN ('AWAITING_PAYMENT', 'BILLED', 'PAYMENT_FAILED')
    RETURNING id
  `
  if (rows.length) logger.error('payment.requires_verification', { orderId, reason })
}

async function verificationResponse(orderId: string, payment: Payment | null, reason: string, message: string) {
  await flagRequiresVerification(orderId, reason)
  const order = await fetchOrderWithItemsAndTable(orderId)
  return ok(order, payment, 'requires_verification', message)
}

async function fetchOrderWithItemsAndTable(orderId: string): Promise<Order | null> {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  if (!order) return null
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order.table_id
    ? await sql`SELECT t.*, s.name AS section_name FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${order.table_id}`
    : [null]
  const table = tableRow ? { ...tableRow, section: tableRow.section_name ? { name: tableRow.section_name } : null } : null
  return { ...order, items, table } as unknown as Order
}

async function latestPaymentFor(orderId: string): Promise<Payment | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT * FROM payments
    WHERE order_id = ${orderId}
    ORDER BY created_at DESC
    LIMIT 1
  `
  return (rows[0] as Payment) ?? null
}

// Polls GetStatus until the terminal reaches a final outcome or the deadline
// passes. Returns the last result — which may still be 'pending'.
//
// CRITICAL: 'pending' means the transaction is still open on the terminal. It
// must never be mapped to a failure, because the customer may complete the
// payment a second later.
async function pollForOutcome(
  ptrid: string,
  ctx: { clientId: string; storeId: string },
  orderId: string,
): Promise<PaymentResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let last: PaymentResult = { status: 'pending', ptrid }
  let attempt = 0

  while (Date.now() < deadline) {
    attempt++
    try {
      last = await paymentProvider.status(ptrid, ctx)
    } catch (err) {
      // A status call failing tells us nothing about the payment — keep trying.
      logger.warn('payment.poll.error', {
        orderId, ptrid, attempt,
        error: err instanceof Error ? err.message : String(err),
      })
      last = { status: 'pending', ptrid }
    }

    if (last.status !== 'pending') {
      logger.info('payment.poll.settled', { orderId, ptrid, attempt, status: last.status })
      return last
    }
    if (Date.now() + POLL_INTERVAL_MS >= deadline) break
    await sleep(POLL_INTERVAL_MS)
  }

  logger.info('payment.poll.timeout', { orderId, ptrid, attempts: attempt })
  return last
}

async function markFailed(orderId: string, payment: Payment | null, statusResult: PaymentResult) {
  const sql = getDb()
  if (payment) {
    await sql`
      UPDATE payments
      SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'},
          raw_response = ${sql.json(toJson(statusResult))}
      WHERE id = ${payment.id}
    `
  }
  await sql`
    UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
    WHERE id = ${orderId} AND pos_status <> 'PAID'
  `
}

// Resolves an order that is already AWAITING_PAYMENT: verify with Pine Labs,
// finalize on approval, keep waiting while pending. Never charges again.
async function resolveAwaitingPayment(
  order: Order,
  terminal: Terminal,
  customerPhone: string | null | undefined,
  customerName: string | null | undefined,
): Promise<NextResponse> {
  const payment = await latestPaymentFor(order.id)

  if (!payment?.plutus_ptrid) {
    // An order already flagged for verification stays flagged: without a PTRID
    // we cannot prove the terminal was never charged.
    if (order.pos_status === 'REQUIRES_VERIFICATION') {
      return ok(
        order,
        payment,
        'requires_verification',
        'No Pine Labs transaction reference is recorded for this order. Verify against the terminal and the Pine Labs report.',
      )
    }
    // Nothing was ever sent to a terminal — safe to release for a retry.
    logger.warn('payment.resolve.no_pending_payment', { orderId: order.id })
    const sql = getDb()
    await sql`
      UPDATE orders SET pos_status = 'PAYMENT_FAILED', payment_status = 'failed'
      WHERE id = ${order.id} AND pos_status = 'AWAITING_PAYMENT'
    `
    const failedOrder = await fetchOrderWithItemsAndTable(order.id)
    return ok(failedOrder ?? order, payment, 'failed', 'No transaction reached the terminal — you can retry.')
  }

  const ctx = {
    clientId: payment.client_id ?? terminal.client_id,
    storeId:  payment.store_id  ?? resolveStoreId(),
  }

  logger.info('payment.resolve.start', { orderId: order.id, ptrid: payment.plutus_ptrid })
  const statusResult = await pollForOutcome(payment.plutus_ptrid, ctx, order.id)
  logger.info('payment.resolve.result', { orderId: order.id, ptrid: payment.plutus_ptrid, status: statusResult.status })

  await recordPaymentEvent({
    paymentId: payment.id,
    orderId: order.id,
    source: 'poll',
    ptrid: payment.plutus_ptrid,
    verified: statusResult.status,
  })

  if (statusResult.status === 'approved') {
    return finalizeOrFlag(order, payment, statusResult, customerPhone, customerName)
  }

  if (statusResult.status === 'pending') {
    const currentOrder = await fetchOrderWithItemsAndTable(order.id)
    return ok(currentOrder ?? order, payment, 'pending', 'Transaction still open on the terminal.')
  }

  await markFailed(order.id, payment, statusResult)
  const failedOrder = await fetchOrderWithItemsAndTable(order.id)
  return ok(
    failedOrder ?? order,
    { ...payment, status: statusResult.status === 'cancelled' ? 'cancelled' : 'declined' } as Payment,
    statusResult.status === 'cancelled' ? 'cancelled' : 'failed',
  )
}

// Finalize, converting an amount mismatch into an explicit
// requires_verification state instead of a 500 or a wrong PAID.
async function finalizeOrFlag(
  order: Order,
  payment: Payment,
  statusResult: PaymentResult,
  customerPhone: string | null | undefined,
  customerName: string | null | undefined,
): Promise<NextResponse> {
  try {
    const result = await finalizeApprovedPayment(order, payment, statusResult, customerPhone, customerName)
    return ok(result.order, result.payment, 'paid')
  } catch (err) {
    if (err instanceof PaymentAmountMismatchError) {
      return verificationResponse(
        order.id,
        payment,
        'amount mismatch',
        'Pine Labs reported a different amount than the bill. Do NOT retry — verify this transaction before continuing.',
      )
    }
    throw err
  }
}

// Before charging again on a previously failed order, make sure no earlier
// transaction is still live on the terminal — otherwise the customer can be
// charged twice (once per open transaction).
async function ensureNoOpenTransaction(
  orderId: string,
  terminal: Terminal,
  customerPhone: string | null | undefined,
  customerName: string | null | undefined,
): Promise<NextResponse | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT * FROM payments
    WHERE order_id = ${orderId} AND status = 'initiated' AND plutus_ptrid IS NOT NULL
    ORDER BY created_at DESC
  `
  const openPayments = rows as unknown as Payment[]
  if (openPayments.length === 0) return null

  for (const open of openPayments) {
    const ctx = { clientId: open.client_id ?? terminal.client_id, storeId: open.store_id ?? resolveStoreId() }
    let statusResult: PaymentResult
    try {
      statusResult = await paymentProvider.status(open.plutus_ptrid as string, ctx)
    } catch (err) {
      logger.error('payment.retry.status_failed', {
        orderId, ptrid: open.plutus_ptrid,
        error: err instanceof Error ? err.message : String(err),
      })
      return verificationResponse(
        orderId,
        open,
        'previous transaction unverifiable',
        'A previous transaction on this order could not be verified. Check the terminal before charging again.',
      )
    }

    if (statusResult.status === 'approved') {
      // The "failed" payment actually went through — recover instead of charging again.
      logger.warn('payment.retry.recovered_approved', { orderId, ptrid: open.plutus_ptrid })
      const currentOrder = await fetchOrderWithItemsAndTable(orderId)
      if (currentOrder) return finalizeOrFlag(currentOrder, open, statusResult, customerPhone, customerName)
    }

    if (statusResult.status === 'pending') {
      // Still open on the terminal — force-cancel it before a new upload.
      try {
        const cancelResult = await paymentProvider.cancel(
          open.plutus_ptrid as string,
          Number(open.amount_paisa),
          ctx,
        )
        if (cancelResult.status !== 'cancelled') throw new Error(`cancel returned ${cancelResult.status}`)
        await sql`UPDATE payments SET status = 'cancelled' WHERE id = ${open.id}`
        logger.info('payment.retry.cancelled_open_txn', { orderId, ptrid: open.plutus_ptrid })
      } catch (err) {
        logger.error('payment.retry.cancel_failed', {
          orderId, ptrid: open.plutus_ptrid,
          error: err instanceof Error ? err.message : String(err),
        })
        return verificationResponse(
          orderId,
          open,
          'open transaction could not be cancelled',
          'A previous transaction is still open on the terminal and could not be cancelled. Clear it on the terminal before retrying.',
        )
      }
      continue
    }

    // declined / cancelled — record it so it is not inspected again.
    await sql`
      UPDATE payments SET status = ${statusResult.status === 'cancelled' ? 'cancelled' : 'declined'}
      WHERE id = ${open.id}
    `
  }

  return null
}

// POST /api/pos/orders/[id]/pay
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json().catch(() => ({}))
    const { mode, customer_phone, customer_name } = body as {
      mode?: string
      customer_phone?: string | null
      customer_name?: string | null
    }

    const sql = getDb()
    const order = await fetchOrderWithItemsAndTable(params.id)
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })

    // Route the bill to the terminal serving this table's section.
    let terminal: Terminal
    try {
      terminal = await selectTerminalForSection(await sectionIdForOrder(params.id))
    } catch (err) {
      if (err instanceof NoTerminalConfiguredError) {
        return NextResponse.json({ data: null, error: err.message }, { status: 500 })
      }
      throw err
    }

    if (order.pos_status === 'PAID') {
      const payment = await latestPaymentFor(order.id)
      return ok(order, payment, 'paid')
    }

    if (order.pos_status === 'AWAITING_PAYMENT' || order.pos_status === 'REQUIRES_VERIFICATION') {
      // Re-verification only — this path never starts a new charge.
      return resolveAwaitingPayment(order, terminal, customer_phone, customer_name)
    }

    if (!['BILLED', 'PAYMENT_FAILED'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot take payment on an order that is ${order.pos_status}` }, { status: 409 })
    }
    if (!mode || !['card', 'cash', 'upi'].includes(mode)) {
      return NextResponse.json({ data: null, error: 'mode must be "card", "cash" or "upi"' }, { status: 400 })
    }
    if (!order.total_paisa || Number(order.total_paisa) <= 0) {
      return NextResponse.json({ data: null, error: 'Order total is zero — regenerate the bill before taking payment' }, { status: 409 })
    }

    // Never start a second charge while an earlier one may still be live.
    const blocked = await ensureNoOpenTransaction(params.id, terminal, customer_phone, customer_name)
    if (blocked) return blocked

    // Atomic claim — whoever's UPDATE matches first wins the charge
    const claimedRows = await sql`
      UPDATE orders SET pos_status = 'AWAITING_PAYMENT'
      WHERE id = ${params.id}
        AND pos_status = ANY(${sql.array(['BILLED', 'PAYMENT_FAILED'])})
      RETURNING *
    `

    if (!claimedRows.length) {
      const freshOrder = await fetchOrderWithItemsAndTable(params.id)
      if (freshOrder?.pos_status === 'AWAITING_PAYMENT') {
        return resolveAwaitingPayment(freshOrder, terminal, customer_phone, customer_name)
      }
      if (freshOrder?.pos_status === 'PAID') {
        const payment = await latestPaymentFor(freshOrder.id)
        return ok(freshOrder, payment, 'paid')
      }
      return NextResponse.json(
        { data: null, error: 'Payment already in progress on this order — refresh and retry' },
        { status: 409 }
      )
    }

    const claimed = { ...claimedRows[0], items: order.items, table: order.table } as Order
    const transactionNumber = `${claimed.order_number}-${Date.now()}`
    logger.info('payment.charge.start', { orderId: claimed.id, transactionNumber, amountPaisa: claimed.total_paisa, mode })

    let chargeResult: PaymentResult
    try {
      chargeResult = await paymentProvider.charge({
        transactionNumber,
        amountPaisa: Number(claimed.total_paisa),
        allowedModes: ALLOWED_MODE_CODE[mode as 'card' | 'cash' | 'upi'],
        clientId: terminal.client_id,
        storeId: resolveStoreId(),
      })
    } catch (chargeErr) {
      // The upload may or may not have reached Pine Labs. Do NOT declare
      // failure — record the attempt and let verification/reconciliation decide.
      const message = chargeErr instanceof Error ? chargeErr.message : String(chargeErr)
      logger.error('payment.charge.error', { orderId: claimed.id, transactionNumber, error: message })
      await sql`
        INSERT INTO payments (order_id, transaction_number, status, mode, amount_paisa, client_id, store_id, raw_response)
        VALUES (
          ${params.id}, ${transactionNumber}, 'initiated', ${mode}, ${claimed.total_paisa},
          ${terminal.client_id}, ${resolveStoreId()}, ${sql.json({ error: message })}
        )
      `
      return verificationResponse(
        params.id,
        null,
        'upload result unknown',
        'Could not confirm the request reached the terminal. Check the terminal before retrying.',
      )
    }

    logger.info('payment.charge.result', { orderId: claimed.id, transactionNumber, ptrid: chargeResult.ptrid, status: chargeResult.status })

    const [paymentRow] = await sql`
      INSERT INTO payments (
        order_id, transaction_number, plutus_ptrid, status, mode,
        amount_paisa, client_id, store_id, raw_response
      ) VALUES (
        ${params.id},
        ${transactionNumber},
        ${chargeResult.ptrid ?? null},
        'initiated',
        ${chargeResult.mode ?? null},
        ${claimed.total_paisa},
        ${terminal.client_id},
        ${resolveStoreId()},
        ${sql.json(toJson(chargeResult))}
      )
      RETURNING *
    `
    const payment = paymentRow as Payment

    // Upload itself was rejected — nothing is live on the terminal.
    if (chargeResult.status === 'declined' || chargeResult.status === 'cancelled') {
      await markFailed(params.id, payment, chargeResult)
      const failedOrder = await fetchOrderWithItemsAndTable(params.id)
      return ok(failedOrder ?? claimed, { ...payment, status: 'declined' } as Payment, 'failed')
    }

    if (!chargeResult.ptrid) {
      // No reference to poll on — must be verified manually.
      return verificationResponse(
        params.id,
        payment,
        'no ptrid returned by upload',
        'Pine Labs did not return a transaction reference. Check the terminal before retrying.',
      )
    }

    const statusResult = await pollForOutcome(
      chargeResult.ptrid,
      { clientId: terminal.client_id, storeId: resolveStoreId() },
      claimed.id,
    )

    if (statusResult.status === 'approved') {
      return finalizeOrFlag(claimed, payment, statusResult, customer_phone, customer_name)
    }

    if (statusResult.status === 'pending') {
      // Still on the terminal. Order stays AWAITING_PAYMENT — the webhook, the
      // cashier pressing "check", or the reconciler will settle it.
      const currentOrder = await fetchOrderWithItemsAndTable(params.id)
      return ok(currentOrder ?? claimed, payment, 'pending', 'Waiting for the customer to complete payment on the terminal.')
    }

    logger.warn('payment.declined', { orderId: claimed.id, ptrid: chargeResult.ptrid, status: statusResult.status })
    await markFailed(params.id, payment, statusResult)
    const failedOrder = await fetchOrderWithItemsAndTable(params.id)
    return ok(
      failedOrder ?? claimed,
      { ...payment, status: statusResult.status === 'cancelled' ? 'cancelled' : 'declined' } as Payment,
      statusResult.status === 'cancelled' ? 'cancelled' : 'failed',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed'
    logger.error('payment.route.error', { orderId: params.id, error: message })
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
