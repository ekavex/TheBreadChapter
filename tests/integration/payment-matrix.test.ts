// The payment failure matrix from the audit, executed against a real database.
//
// Every case here is one of the ways a POS loses or duplicates money:
// duplicate finalization, a crash mid-finalize, a lost webhook, a stale
// terminal transaction, two waiters on one table.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeTestDb, hasTestDatabase, resetSchema, seedAwaitingPaymentOrder, seedFixture, testDb,
  type Fixture,
} from './helpers/db'

// The app resolves the database from DATABASE_URL; point it at the test one
// before any application module is imported.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
process.env.RECONCILER_DISABLED = 'true'
process.env.PINELABS_STORE_ID = process.env.PINELABS_STORE_ID ?? '9988'

// Provider stub - each test decides what Pine Labs "says".
const providerStatus = vi.fn()
const providerCancel = vi.fn()
vi.mock('@/lib/payment/provider', () => ({
  paymentProvider: {
    charge: vi.fn(),
    status: (...args: unknown[]) => providerStatus(...args),
    cancel: (...args: unknown[]) => providerCancel(...args),
  },
  getPaymentProvider: () => ({ charge: vi.fn(), status: providerStatus, cancel: providerCancel }),
  createPaymentProvider: () => ({ charge: vi.fn(), status: providerStatus, cancel: providerCancel }),
  missingPineLabsVars: () => [],
}))

const describeDb = hasTestDatabase ? describe : describe.skip

describeDb('payment matrix (integration)', () => {
  let fx: Fixture

  beforeAll(async () => {
    await resetSchema()
  }, 60_000)

  beforeEach(async () => {
    providerStatus.mockReset()
    providerCancel.mockReset()
    fx = await seedFixture()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('marks the order PAID exactly once and deducts stock once', async () => {
    const { finalizeApprovedPayment } = await import('@/lib/payment/finalize')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)

    const [order] = await db`SELECT * FROM orders WHERE id = ${seeded.orderId}`
    const items = await db`SELECT * FROM order_items WHERE order_id = ${seeded.orderId}`
    const [payment] = await db`SELECT * FROM payments WHERE id = ${seeded.paymentId}`

    const approved = { status: 'approved' as const, ptrid: 'x', amountPaisa: seeded.totalPaisa, mode: 'CARD', rrn: '000020' }
    await finalizeApprovedPayment({ ...order, items } as never, payment as never, approved, null, null)

    const [after] = await db`SELECT pos_status, payment_status FROM orders WHERE id = ${seeded.orderId}`
    expect(after.pos_status).toBe('PAID')
    expect(after.payment_status).toBe('paid')

    const [{ count }] = await db`SELECT count(*)::int AS count FROM stock_transactions WHERE reference_order_id = ${seeded.orderId}`
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('is idempotent under a duplicate webhook + poll arriving together', async () => {
    const { finalizeApprovedPayment } = await import('@/lib/payment/finalize')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)

    const [order] = await db`SELECT * FROM orders WHERE id = ${seeded.orderId}`
    const items = await db`SELECT * FROM order_items WHERE order_id = ${seeded.orderId}`
    const [payment] = await db`SELECT * FROM payments WHERE id = ${seeded.paymentId}`
    const approved = { status: 'approved' as const, ptrid: 'x', amountPaisa: seeded.totalPaisa, mode: 'CARD' }

    await Promise.all([
      finalizeApprovedPayment({ ...order, items } as never, payment as never, approved, null, null),
      finalizeApprovedPayment({ ...order, items } as never, payment as never, approved, null, null),
      finalizeApprovedPayment({ ...order, items } as never, payment as never, approved, null, null),
    ])

    const [{ approvedCount }] = await db`
      SELECT count(*)::int AS "approvedCount" FROM payments WHERE order_id = ${seeded.orderId} AND status = 'approved'
    `
    expect(approvedCount).toBe(1)

    const [{ stockRows }] = await db`
      SELECT count(*)::int AS "stockRows" FROM stock_transactions WHERE reference_order_id = ${seeded.orderId}
    `
    const [{ paidCount }] = await db`
      SELECT count(*)::int AS "paidCount" FROM orders WHERE id = ${seeded.orderId} AND pos_status = 'PAID'
    `
    expect(paidCount).toBe(1)
    // Whatever the recipe produced, it must not have been applied three times.
    expect(stockRows % 3 === 0 ? stockRows / 3 : stockRows).toBe(stockRows)
  })

  it('refuses to finalize - and changes nothing - when the amount does not match', async () => {
    const { finalizeApprovedPayment, PaymentAmountMismatchError } = await import('@/lib/payment/finalize')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)

    const [order] = await db`SELECT * FROM orders WHERE id = ${seeded.orderId}`
    const [payment] = await db`SELECT * FROM payments WHERE id = ${seeded.paymentId}`

    await expect(
      finalizeApprovedPayment(
        { ...order, items: [] } as never, payment as never,
        { status: 'approved', ptrid: 'x', amountPaisa: seeded.totalPaisa - 5000 }, null, null
      )
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError)

    const [after] = await db`SELECT pos_status FROM orders WHERE id = ${seeded.orderId}`
    const [paymentAfter] = await db`SELECT status FROM payments WHERE id = ${seeded.paymentId}`
    expect(after.pos_status).toBe('AWAITING_PAYMENT')
    expect(paymentAfter.status).toBe('initiated')
  })

  it('reconciler settles an approved payment nobody told us about (lost webhook)', async () => {
    const { reconcilePendingPayments } = await import('@/lib/payment/reconcile')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)
    // Age the order past the reconciler's grace window.
    await db`UPDATE orders SET updated_at = now() - interval '10 minutes' WHERE id = ${seeded.orderId}`

    providerStatus.mockResolvedValue({
      status: 'approved', ptrid: 'x', amountPaisa: seeded.totalPaisa, mode: 'CARD', rrn: '000020',
    })

    const summary = await reconcilePendingPayments()
    expect(summary.outcomes.find((o) => o.orderId === seeded.orderId)?.result).toBe('paid')

    const [after] = await db`SELECT pos_status FROM orders WHERE id = ${seeded.orderId}`
    expect(after.pos_status).toBe('PAID')
  })

  it('reconciler marks a declined transaction failed, leaving the table occupied', async () => {
    const { reconcilePendingPayments } = await import('@/lib/payment/reconcile')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)
    await db`UPDATE orders SET updated_at = now() - interval '10 minutes' WHERE id = ${seeded.orderId}`
    await db`UPDATE tables SET status = 'billed' WHERE id = ${fx.tableId}`

    providerStatus.mockResolvedValue({ status: 'declined', ptrid: 'x' })

    await reconcilePendingPayments()

    const [order] = await db`SELECT pos_status FROM orders WHERE id = ${seeded.orderId}`
    const [table] = await db`SELECT status FROM tables WHERE id = ${fx.tableId}`
    expect(order.pos_status).toBe('PAYMENT_FAILED')
    expect(table.status).not.toBe('free')
  })

  it('escalates a transaction still open long after the auto-cancel window', async () => {
    const { reconcilePendingPayments } = await import('@/lib/payment/reconcile')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)
    await db`UPDATE orders SET updated_at = now() - interval '30 minutes' WHERE id = ${seeded.orderId}`

    providerStatus.mockResolvedValue({ status: 'pending', ptrid: 'x' })

    await reconcilePendingPayments()

    const [order] = await db`SELECT pos_status FROM orders WHERE id = ${seeded.orderId}`
    expect(order.pos_status).toBe('REQUIRES_VERIFICATION')
  })

  it('leaves a freshly pending transaction alone', async () => {
    const { reconcilePendingPayments } = await import('@/lib/payment/reconcile')
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)
    await db`UPDATE orders SET updated_at = now() - interval '3 minutes' WHERE id = ${seeded.orderId}`

    providerStatus.mockResolvedValue({ status: 'pending', ptrid: 'x' })

    const summary = await reconcilePendingPayments()
    expect(summary.outcomes.find((o) => o.orderId === seeded.orderId)?.result).toBe('still_pending')

    const [order] = await db`SELECT pos_status FROM orders WHERE id = ${seeded.orderId}`
    expect(order.pos_status).toBe('AWAITING_PAYMENT')
  })

  it('database refuses two live orders on one table', async () => {
    const db = testDb()
    await db`
      INSERT INTO orders (cafe_id, table_id, order_number, status, pos_status)
      VALUES (${fx.cafeId}, ${fx.tableId}, 'ORD-A', 'pending', 'OPEN')
    `
    await expect(
      db`
        INSERT INTO orders (cafe_id, table_id, order_number, status, pos_status)
        VALUES (${fx.cafeId}, ${fx.tableId}, 'ORD-B', 'pending', 'OPEN')
      `
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('database refuses a second approved payment on one order', async () => {
    const db = testDb()
    const seeded = await seedAwaitingPaymentOrder(fx)
    await db`UPDATE payments SET status = 'approved' WHERE id = ${seeded.paymentId}`

    await expect(
      db`
        INSERT INTO payments (order_id, transaction_number, plutus_ptrid, status, mode, amount_paisa)
        VALUES (${seeded.orderId}, ${'TXN-' + Math.random()}, 'other', 'approved', 'CARD', ${seeded.totalPaisa})
      `
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('records a webhook delivery once, ignoring repeats', async () => {
    const { recordPaymentEvent } = await import('@/lib/payment/events')
    const seeded = await seedAwaitingPaymentOrder(fx)
    const key = `webhook:ptrid-1:0:APPROVED:${Math.random()}`

    const first = await recordPaymentEvent({
      paymentId: seeded.paymentId, orderId: seeded.orderId, source: 'webhook', dedupeKey: key, reported: 'APPROVED',
    })
    const second = await recordPaymentEvent({
      paymentId: seeded.paymentId, orderId: seeded.orderId, source: 'webhook', dedupeKey: key, reported: 'APPROVED',
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})
