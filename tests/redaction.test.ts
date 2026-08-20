import { describe, expect, it } from 'vitest'
import { redactPaymentPayload, toStorableJson } from '@/lib/observability/redact'

describe('payment payload redaction', () => {
  it('reduces a card number to its last four digits', () => {
    const out = redactPaymentPayload({ CardNumber: '************2428' }) as Record<string, string>
    expect(out.CardNumber).toBe('****2428')
  })

  it('redacts Pine Labs TransactionData by Tag, keeping reconciliation fields', () => {
    const out = redactPaymentPayload({
      TransactionData: [
        { Tag: 'CardNumber', Value: '************2428' },
        { Tag: 'CustomerVPA', Value: 'someone@upi' },
        { Tag: 'RRN', Value: '000020' },
        { Tag: 'AmountInPaisa', Value: '25000' },
      ],
    }) as { TransactionData: { Tag: string; Value: string }[] }

    const byTag = Object.fromEntries(out.TransactionData.map((t) => [t.Tag, t.Value]))
    expect(byTag.CardNumber).toBe('****2428')
    expect(byTag.CustomerVPA).toBe('[redacted]')
    expect(byTag.RRN).toBe('000020')
    expect(byTag.AmountInPaisa).toBe('25000')
  })

  it('never leaks the security token', () => {
    const out = redactPaymentPayload({ SecurityToken: 'super-secret', MerchantID: 123 }) as Record<string, unknown>
    expect(out.SecurityToken).toBe('[redacted]')
    expect(out.MerchantID).toBe(123)
  })

  it('keeps everything a reconciliation actually needs', () => {
    const out = toStorableJson({
      status: 'approved',
      ptrid: '701409',
      rrn: '000020',
      approvalCode: '00',
      txnLogId: '4295508003',
      amountPaisa: 25000,
      mode: 'UPI SALE',
    }) as Record<string, unknown>

    expect(out).toMatchObject({
      status: 'approved',
      ptrid: '701409',
      rrn: '000020',
      approvalCode: '00',
      txnLogId: '4295508003',
      amountPaisa: 25000,
      mode: 'UPI SALE',
    })
  })

  it('handles nesting and null without throwing', () => {
    expect(redactPaymentPayload(null)).toBeNull()
    const out = redactPaymentPayload({ raw: { inner: { CardNumber: '4111111111111111' } } }) as
      { raw: { inner: { CardNumber: string } } }
    expect(out.raw.inner.CardNumber).toBe('****1111')
  })
})
