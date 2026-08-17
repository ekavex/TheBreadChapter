import { describe, expect, it, vi } from 'vitest'

// The amount check runs before any database work, so this exercises the real
// guard without a live Postgres. getDb is stubbed to prove it is never reached
// on a mismatch — i.e. a wrong-amount "approval" can never write PAID.
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => {
    throw new Error('database must not be touched when the amount does not match')
  }),
}))

import { getDb } from '@/lib/db'

import { finalizeApprovedPayment, PaymentAmountMismatchError } from '@/lib/payment/finalize'
import type { Order, Payment } from '@/lib/types'

const order = { id: 'order-1', order_number: 'ORD-0001', total_paisa: 25000, items: [] } as unknown as Order
const payment = { id: 'payment-1', mode: 'CARD' } as unknown as Payment

describe('finalization amount verification', () => {
  it('refuses to finalize when Pine Labs reports a different amount', async () => {
    await expect(
      finalizeApprovedPayment(order, payment, { status: 'approved', ptrid: '1', amountPaisa: 15000 }, null, null)
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError)
    expect(getDb).not.toHaveBeenCalled()
  })

  it('reports both amounts so the mismatch can be reconciled', async () => {
    const err: PaymentAmountMismatchError = await finalizeApprovedPayment(
      order, payment, { status: 'approved', ptrid: '1', amountPaisa: 15000 }, null, null
    ).then(
      () => { throw new Error('expected a mismatch error') },
      (e) => e as PaymentAmountMismatchError
    )

    expect(err.expectedPaisa).toBe(25000)
    expect(err.reportedPaisa).toBe(15000)
    expect(err.message).toContain('order-1')
  })

  it('passes the guard when the amount matches (then needs the database)', async () => {
    await expect(
      finalizeApprovedPayment(order, payment, { status: 'approved', ptrid: '1', amountPaisa: 25000 }, null, null)
    ).rejects.toThrow(/database must not be touched/)
  })

  it('passes the guard when Pine Labs reports no amount at all', async () => {
    await expect(
      finalizeApprovedPayment(order, payment, { status: 'approved', ptrid: '1' }, null, null)
    ).rejects.toThrow(/database must not be touched/)
  })
})
