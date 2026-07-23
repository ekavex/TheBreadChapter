// ─── PaymentProvider abstraction (Module 5 + Pine Labs) ──────
// Spec: docs/PINELABS_INTEGRATION_MASTER.md §10. Business logic (orders,
// stock, dashboard) talks to this interface only — never HTTP/paisa/tag
// parsing directly. MockPaymentProvider ships first; PineLabsCloudProvider
// (M6) implements the same interface once UAT credentials exist.

export type PaymentResultStatus = 'approved' | 'declined' | 'cancelled' | 'pending'

export interface PaymentResult {
  status: PaymentResultStatus
  ptrid?: string
  mode?: string          // CARD | UPI SALE | CASH
  amountPaisa?: number
  rrn?: string
  approvalCode?: string
  txnLogId?: string
  raw?: unknown
}

export interface ChargeInput {
  transactionNumber: string
  amountPaisa: number
  allowedModes: string   // e.g. "1|2|10"
  clientId: string       // target terminal
  storeId: string
  userId?: string
}

export interface TerminalContext {
  clientId: string
  storeId: string
}

export interface PaymentProvider {
  // maps to UploadBilledTransaction -> returns PTRID (status 'pending')
  charge(input: ChargeInput): Promise<PaymentResult>
  // maps to GetStatus(PTRID)
  status(ptrid: string, ctx: TerminalContext): Promise<PaymentResult>
  // maps to CancelTransactionForced
  cancel(ptrid: string, amountPaisa: number, ctx: TerminalContext): Promise<PaymentResult>
}
