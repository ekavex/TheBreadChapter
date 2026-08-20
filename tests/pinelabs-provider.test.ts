import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PineLabsCloudProvider, PineLabsTimeoutError } from '@/lib/payment/PineLabsCloudProvider'

const CTX = { clientId: '55', storeId: '9988' }

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {
    PINELABS_MERCHANT_ID: process.env.PINELABS_MERCHANT_ID,
    PINELABS_SECURITY_TOKEN: process.env.PINELABS_SECURITY_TOKEN,
    PINELABS_STORE_ID: process.env.PINELABS_STORE_ID,
    PINELABS_BASE_URL: process.env.PINELABS_BASE_URL,
    PINELABS_TIMEOUT_MS: process.env.PINELABS_TIMEOUT_MS,
  }
  process.env.PINELABS_MERCHANT_ID = '123456'
  process.env.PINELABS_SECURITY_TOKEN = 'token-abc'
  process.env.PINELABS_STORE_ID = '9988'
  process.env.PINELABS_BASE_URL = 'https://plutus.example'
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k]
    else (process.env as Record<string, string | undefined>)[k] = v
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('charge → UploadBilledTransaction', () => {
  it('sends paisa, the routed ClientId and the auto-cancel window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ResponseCode: 0, ResponseMessage: 'SUCCESS', PlutusTransactionReferenceID: 701409 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new PineLabsCloudProvider().charge({
      transactionNumber: 'ORD-0001-123',
      amountPaisa: 25000,
      allowedModes: '1',
      clientId: '55',
      storeId: '9988',
    })

    expect(result.status).toBe('pending')
    expect(result.ptrid).toBe('701409')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.Amount).toBe(25000)
    expect(body.ClientId).toBe(55)
    expect(body.MerchantID).toBe(123456)
    expect(body.AutoCancelDurationInMinutes).toBe(5)
  })

  it('never charges without a routable terminal', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      new PineLabsCloudProvider().charge({
        transactionNumber: 'ORD-1', amountPaisa: 100, allowedModes: '1', clientId: '', storeId: '9988',
      })
    ).rejects.toThrow(/ClientId/)
  })

  it('rejects a non-integer or zero amount', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const p = new PineLabsCloudProvider()
    await expect(
      p.charge({ transactionNumber: 'a', amountPaisa: 0, allowedModes: '1', clientId: '55', storeId: '1' })
    ).rejects.toThrow(/Invalid amount/)
    await expect(
      p.charge({ transactionNumber: 'a', amountPaisa: 10.5, allowedModes: '1', clientId: '55', storeId: '1' })
    ).rejects.toThrow(/Invalid amount/)
  })

  it('does NOT retry an upload that may already have created a transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new PineLabsCloudProvider().charge({
        transactionNumber: 'ORD-1', amountPaisa: 100, allowedModes: '1', clientId: '55', storeId: '9988',
      })
    ).rejects.toThrow(/HTTP 503/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('status → GetCloudBasedTxnStatus', () => {
  it('maps an approved response and parses TransactionData by Tag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({
        ResponseCode: 0,
        ResponseMessage: 'TXN APPROVED',
        PlutusTransactionReferenceID: 701409,
        TransactionData: [
          { Tag: 'RRN', Value: '000020' },
          { Tag: 'AmountInPaisa', Value: '25000' },
          { Tag: 'PaymentMode', Value: 'UPI SALE' },
          { Tag: 'ApprovalCode', Value: '00' },
          { Tag: 'TransactionLogId', Value: '4295508003' },
        ],
      })
    ))

    const r = await new PineLabsCloudProvider().status('701409', CTX)
    expect(r.status).toBe('approved')
    expect(r.amountPaisa).toBe(25000)
    expect(r.mode).toBe('UPI SALE')
    expect(r.rrn).toBe('000020')
    expect(r.txnLogId).toBe('4295508003')
  })

  it('treats an unknown/open response as pending, never as failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ ResponseCode: 3, ResponseMessage: 'TXN IN PROGRESS', PlutusTransactionReferenceID: 1 })
    ))
    expect((await new PineLabsCloudProvider().status('1', CTX)).status).toBe('pending')
  })

  it('maps a voided transaction to cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ ResponseCode: 1008, ResponseMessage: 'TXN VOIDED', PlutusTransactionReferenceID: 1 })
    ))
    expect((await new PineLabsCloudProvider().status('1', CTX)).status).toBe('cancelled')
  })

  it('maps an explicit decline to declined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ ResponseCode: 1, ResponseMessage: 'DECLINED', PlutusTransactionReferenceID: 1 })
    ))
    expect((await new PineLabsCloudProvider().status('1', CTX)).status).toBe('declined')
  })

  it('retries an idempotent status call on a 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({ ResponseCode: 0, ResponseMessage: 'APPROVED', PlutusTransactionReferenceID: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    expect((await new PineLabsCloudProvider().status('1', CTX)).status).toBe('approved')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts a hung request instead of pinning the cashier', async () => {
    process.env.PINELABS_TIMEOUT_MS = '30'
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    ))

    await expect(new PineLabsCloudProvider().status('1', CTX)).rejects.toBeInstanceOf(PineLabsTimeoutError)
  })
})
