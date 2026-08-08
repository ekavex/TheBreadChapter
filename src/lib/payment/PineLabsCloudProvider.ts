// Pine Labs Cloud Integration — M6.
// Implements PaymentProvider against Pine Labs' CloudBasedIntegration V1 API.
// All calls are server-to-server; SecurityToken never leaves the backend.
//
// Endpoint paths — CONFIRM with Pine Labs before go-live (§16 of the spec):
//   Upload:    /API/CloudBasedIntegration/V1/UploadBilledTransaction
//   GetStatus: /API/CloudBasedIntegration/V1/GetCloudBasedTxnStatus
//   Cancel:    /API/CloudBasedIntegration/V1/CancelTransactionForced
//
// Spec reference: docs/PINELABS_INTEGRATION_MASTER.md

import { logger } from '@/lib/logger'
import type { PaymentProvider, PaymentResult, ChargeInput, TerminalContext } from './types'

// Auto-cancel the open transaction on the terminal if not settled in N minutes.
const AUTO_CANCEL_MINUTES = 5

// ─── Pine Labs response shapes ───────────────────────────────────────────────

interface UploadResponse {
  ResponseCode: number
  ResponseMessage: string
  PlutusTransactionReferenceID: number
  AdditionalInfo?: unknown
}

interface StatusResponse {
  ResponseCode: number
  ResponseMessage: string
  PlutusTransactionReferenceID: number
  TransactionData?: { Tag: string; Value: string }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// CRITICAL: always parse TransactionData by Tag — never by index.
// Tags and their order vary by payment mode (card vs UPI vs cash).
function tagsToMap(rows: { Tag: string; Value: string }[] = []): Record<string, string> {
  const m: Record<string, string> = {}
  for (const { Tag, Value } of rows) m[Tag.trim()] = Value
  return m
}

function parseTransactionData(resp: StatusResponse): Partial<PaymentResult> {
  const t = tagsToMap(resp.TransactionData)
  return {
    // Pine Labs spec has a known typo: "PaymenMode" in Post Back; GetStatus uses "PaymentMode"
    mode:         t['PaymentMode'] ?? t['PaymenMode'] ?? undefined,
    amountPaisa:  t['AmountInPaisa'] ? Number(t['AmountInPaisa']) : undefined,
    rrn:          t['RRN']              ?? undefined,
    approvalCode: t['ApprovalCode']     ?? undefined,
    txnLogId:     t['TransactionLogId'] ?? undefined,
  }
}

async function plPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pine Labs HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class PineLabsCloudProvider implements PaymentProvider {
  private readonly base:    string
  private readonly mid:     string  // MerchantID
  private readonly token:   string  // SecurityToken
  private readonly storeId: string  // always this cafe's store

  constructor() {
    this.base    = (process.env.PINELABS_BASE_URL    ?? 'https://www.plutuscloudserviceuat.in:8201').replace(/\/$/, '')
    this.mid     = process.env.PINELABS_MERCHANT_ID    ?? ''
    this.token   = process.env.PINELABS_SECURITY_TOKEN ?? ''
    this.storeId = process.env.PINELABS_STORE_ID       ?? ''
  }

  // ─── charge → UploadBilledTransaction ──────────────────────────────────────
  // Pushes the bill to Pine Labs cloud; the A910S picks it up by ClientId.
  // Returns status:'pending' + PTRID on success — caller must poll status().
  async charge(input: ChargeInput): Promise<PaymentResult> {
    const url = `${this.base}/API/CloudBasedIntegration/V1/UploadBilledTransaction`
    const body = {
      MerchantID:                   Number(this.mid),
      SecurityToken:                this.token,
      TransactionNumber:            input.transactionNumber,
      SequenceNumber:               1,
      AllowedPaymentMode:           input.allowedModes,
      Amount:                       input.amountPaisa,
      TotalInvoiceAmount:           input.amountPaisa,
      StoreId:                      Number(this.storeId),
      ClientId:                     Number(input.clientId),
      UserID:                       input.userId ?? 'WAITER',
      AutoCancelDurationInMinutes:  AUTO_CANCEL_MINUTES,
      ForceCancelOnBack:            true,
    }

    logger.info('pinelabs.upload.start', {
      txn: input.transactionNumber,
      amtPaisa: input.amountPaisa,
      clientId: input.clientId,
      mode: input.allowedModes,
    })

    const resp = await plPost<UploadResponse>(url, body)

    logger.info('pinelabs.upload.response', {
      txn:  input.transactionNumber,
      code: resp.ResponseCode,
      msg:  resp.ResponseMessage,
      ptrid: resp.PlutusTransactionReferenceID,
    })

    if (resp.ResponseCode !== 0 || !resp.PlutusTransactionReferenceID) {
      return { status: 'declined', ptrid: String(resp.PlutusTransactionReferenceID ?? ''), raw: resp }
    }

    return {
      status: 'pending',
      ptrid:  String(resp.PlutusTransactionReferenceID),
      raw:    resp,
    }
  }

  // ─── status → GetCloudBasedTxnStatus ───────────────────────────────────────
  // Checks final state by PTRID. Returns 'pending' when the terminal hasn't
  // settled yet — caller should poll until approved/declined/cancelled.
  async status(ptrid: string, ctx: TerminalContext): Promise<PaymentResult> {
    const url = `${this.base}/API/CloudBasedIntegration/V1/GetCloudBasedTxnStatus`
    const body = {
      MerchantID:                   String(this.mid),
      SecurityToken:                this.token,
      ClientID:                     String(ctx.clientId),
      UserID:                       'WAITER',
      StoreID:                      String(this.storeId),
      PlutusTransactionReferenceID: Number(ptrid),
    }

    logger.info('pinelabs.status.start', { ptrid })

    const resp = await plPost<StatusResponse>(url, body)

    logger.info('pinelabs.status.response', {
      ptrid,
      code: resp.ResponseCode,
      msg:  resp.ResponseMessage,
    })

    const msg = (resp.ResponseMessage ?? '').toUpperCase()

    // Approved
    if (resp.ResponseCode === 0 && (msg.includes('APPROVED') || msg.includes('TXN APPROVED'))) {
      return {
        status: 'approved',
        ptrid,
        ...parseTransactionData(resp),
        raw: resp,
      }
    }

    // Voided / explicitly cancelled
    if (resp.ResponseCode === 1008 || msg.includes('VOID') || msg.includes('CANCEL')) {
      return { status: 'cancelled', ptrid, raw: resp }
    }

    // Explicitly declined / failed
    if (msg.includes('DECLINED') || msg.includes('FAILED') || msg.includes('INVALID PLUTUS')) {
      return { status: 'declined', ptrid, raw: resp }
    }

    // Anything else — transaction still open on terminal, keep polling
    return { status: 'pending', ptrid, raw: resp }
  }

  // ─── cancel → CancelTransactionForced ──────────────────────────────────────
  // Best-effort cancel; valid only before PIN entry (see §5.3 of spec).
  async cancel(ptrid: string, amountPaisa: number, ctx: TerminalContext): Promise<PaymentResult> {
    const url = `${this.base}/API/CloudBasedIntegration/V1/CancelTransactionForced`
    const body = {
      MerchantID:                   String(this.mid),
      SecurityToken:                this.token,
      PlutusTransactionReferenceID: ptrid,
      Amount:                       String(amountPaisa),
      StoreId:                      Number(this.storeId),
      ClientId:                     Number(ctx.clientId),
      TakeToHomeScreen:             true,
      ConfirmationRequired:         false,
    }

    logger.info('pinelabs.cancel.start', { ptrid, amtPaisa: amountPaisa })

    const resp = await plPost<StatusResponse>(url, body)

    logger.info('pinelabs.cancel.response', { ptrid, code: resp.ResponseCode, msg: resp.ResponseMessage })

    const msg = (resp.ResponseMessage ?? '').toUpperCase()

    if (resp.ResponseCode === 0 || msg.includes('CANCEL') || msg.includes('SUCCESS')) {
      return { status: 'cancelled', ptrid, raw: resp }
    }

    return { status: 'declined', ptrid, raw: resp }
  }
}
