import type { PaymentProvider, PaymentResult, ChargeInput, TerminalContext } from './types'

// In-memory only - fine for a single long-running dev/prod Node process.
// Real state of truth once M6 lands is Pine Labs + our `payments` table.
const store = new Map<string, PaymentResult>()

interface MockPaymentProviderOptions {
  outcome?: 'approved' | 'declined' | 'cancelled'
  delayMs?: number
}

export class MockPaymentProvider implements PaymentProvider {
  private outcome: 'approved' | 'declined' | 'cancelled'
  private delayMs: number

  constructor(opts: MockPaymentProviderOptions = {}) {
    this.outcome = opts.outcome ?? (process.env.MOCK_PAYMENT_OUTCOME as MockPaymentProviderOptions['outcome']) ?? 'approved'
    this.delayMs = opts.delayMs ?? 0
  }

  async charge(input: ChargeInput): Promise<PaymentResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))

    const ptrid = `MOCK-${input.transactionNumber}`
    const mode = input.allowedModes.includes('10') ? 'UPI SALE' : input.allowedModes.includes('1') ? 'CARD' : 'CASH'

    const result: PaymentResult =
      this.outcome === 'approved'
        ? {
            status: 'approved',
            ptrid,
            mode,
            amountPaisa: input.amountPaisa,
            rrn: `MOCKRRN${Date.now()}`,
            approvalCode: 'MOCK00',
            txnLogId: `MOCKLOG${Date.now()}`,
          }
        : { status: this.outcome, ptrid, mode, amountPaisa: input.amountPaisa }

    store.set(ptrid, result)
    return result
  }

  async status(ptrid: string, _ctx: TerminalContext): Promise<PaymentResult> {
    return store.get(ptrid) ?? { status: 'declined', ptrid }
  }

  async cancel(ptrid: string, _amountPaisa: number, _ctx: TerminalContext): Promise<PaymentResult> {
    const existing = store.get(ptrid)
    const result: PaymentResult = { status: 'cancelled', ptrid }
    if (existing) store.set(ptrid, result)
    return result
  }
}

// Provider selection lives in ./provider.ts - importing `paymentProvider` from
// this file used to silently enable the mock in production (P0). Import from
// '@/lib/payment/provider' instead.
