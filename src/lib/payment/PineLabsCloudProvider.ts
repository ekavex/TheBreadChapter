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

// ─── HTTP transport ──────────────────────────────────────────────────────────
//
// Timeouts are mandatory: a hung Pine Labs connection would otherwise pin a
// request until the proxy kills it, with the cashier staring at a spinner.
//
// Retry policy is deliberately asymmetric:
//   • GetStatus / Cancel are read-ish and idempotent → safe to retry.
//   • UploadBilledTransaction creates a payable transaction on the terminal →
//     retrying a request that may have been received would risk two live
//     transactions, i.e. a double charge. It is retried ONLY when the request
//     provably never reached Pine Labs (connection-level failure before any
//     response), and never after a timeout.

const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_BACKOFF_MS = [400, 1200]

export class PineLabsTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Pine Labs request timed out after ${timeoutMs}ms: ${url}`)
    this.name = 'PineLabsTimeoutError'
  }
}

function timeoutMs(): number {
  const configured = Number(process.env.PINELABS_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS
}

interface PostOptions {
  /** Retry on connection-level failures. Never enable for Upload after a timeout. */
  retryOnConnectionError?: boolean
  /** Retry when Pine Labs answers 5xx — only safe for idempotent calls. */
  retryOnServerError?: boolean
}

async function plPostOnce<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const ms = timeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
      cache:   'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Pine Labs HTTP ${res.status}: ${text.slice(0, 300)}`) as Error & { httpStatus?: number }
      err.httpStatus = res.status
      throw err
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PineLabsTimeoutError(url, ms)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function plPost<T>(url: string, body: Record<string, unknown>, opts: PostOptions = {}): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await plPostOnce<T>(url, body)
    } catch (err) {
      lastErr = err
      const status = (err as { httpStatus?: number }).httpStatus
      const isTimeout = err instanceof PineLabsTimeoutError
      const isServerError = typeof status === 'number' && status >= 500
      const isConnectionError = !isTimeout && status === undefined

      const retryable =
        (isConnectionError && opts.retryOnConnectionError) ||
        (isServerError && opts.retryOnServerError) ||
        (isTimeout && opts.retryOnServerError)

      if (!retryable || attempt === RETRY_BACKOFF_MS.length) break

      logger.warn('pinelabs.retry', {
        url,
        attempt: attempt + 1,
        reason: isTimeout ? 'timeout' : isServerError ? `http_${status}` : 'connection',
      })
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]))
    }
  }
  throw lastErr
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class PineLabsCloudProvider implements PaymentProvider {
  private readonly base:    string
  private readonly mid:     string  // MerchantID
  private readonly token:   string  // SecurityToken
  private readonly storeId: string  // always this cafe's store

  constructor() {
    this.base    = (process.env.PINELABS_BASE_URL    ?? 'https://www.plutuscloudserviceuat.in:8201').replace(/\/$/, '')
    this.mid     = (process.env.PINELABS_MERCHANT_ID    ?? '').trim()
    this.token   = (process.env.PINELABS_SECURITY_TOKEN ?? '').trim()
    this.storeId = (process.env.PINELABS_STORE_ID       ?? '').trim()

    // Fail loudly at construction rather than sending a malformed Upload:
    // MerchantID and StoreId go to Pine Labs as numbers, and Number('') is 0.
    const problems: string[] = []
    if (!this.mid)     problems.push('PINELABS_MERCHANT_ID is empty')
    if (!this.token)   problems.push('PINELABS_SECURITY_TOKEN is empty')
    if (!this.storeId) problems.push('PINELABS_STORE_ID is empty')
    if (this.mid && !Number.isFinite(Number(this.mid)))         problems.push('PINELABS_MERCHANT_ID must be numeric')
    if (this.storeId && !Number.isFinite(Number(this.storeId))) problems.push('PINELABS_STORE_ID must be numeric')
    if (!/^https:\/\//.test(this.base)) problems.push('PINELABS_BASE_URL must be https')
    if (problems.length) {
      throw new Error(`Invalid Pine Labs configuration: ${problems.join('; ')}`)
    }
  }

  // ─── charge → UploadBilledTransaction ──────────────────────────────────────
  // Pushes the bill to Pine Labs cloud; the A910S picks it up by ClientId.
  // Returns status:'pending' + PTRID on success — caller must poll status().
  async charge(input: ChargeInput): Promise<PaymentResult> {
    const url = `${this.base}/API/CloudBasedIntegration/V1/UploadBilledTransaction`
    if (!input.clientId || !Number.isFinite(Number(input.clientId))) {
      throw new Error(`Invalid terminal ClientId "${input.clientId}" — the bill cannot be routed to a terminal`)
    }
    if (!Number.isInteger(input.amountPaisa) || input.amountPaisa <= 0) {
      throw new Error(`Invalid amount ${input.amountPaisa} — Pine Labs requires a positive integer paisa amount`)
    }
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

    // Upload is NOT idempotent — only retried when the connection never landed.
    const resp = await plPost<UploadResponse>(url, body, { retryOnConnectionError: true })

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

    const resp = await plPost<StatusResponse>(url, body, { retryOnConnectionError: true, retryOnServerError: true })

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

    const resp = await plPost<StatusResponse>(url, body, { retryOnConnectionError: true, retryOnServerError: true })

    logger.info('pinelabs.cancel.response', { ptrid, code: resp.ResponseCode, msg: resp.ResponseMessage })

    const msg = (resp.ResponseMessage ?? '').toUpperCase()

    if (resp.ResponseCode === 0 || msg.includes('CANCEL') || msg.includes('SUCCESS')) {
      return { status: 'cancelled', ptrid, raw: resp }
    }

    return { status: 'declined', ptrid, raw: resp }
  }
}
