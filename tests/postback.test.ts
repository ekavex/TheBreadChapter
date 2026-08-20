import { describe, expect, it } from 'vitest'
import { parsePostBack, parsePostBackBody } from '@/lib/payment/postback'

// Sample taken verbatim from docs/PINELABS_INTEGRATION_MASTER.md §6.
const SAMPLE =
  'ResponseCode=0,ResponseMessage=APPROVED,PlutusTransactionReferenceID=701409,' +
  'TransactionNumber=ORDER-1042,BankTID=10130951,PaymenMode=CARD,Amount=25000,' +
  'ApprovalCode=00,RRN=000020,Invoice=4,BatchNumber=9014,' +
  'CardNumber=************2428,AcquirerName=ICICI,' +
  'TransactionDate=15042025,TransactionTime=123031,CardType=VISA,' +
  'TransactionLogId=4295508003,CurrencyType=INR'

describe('Pine Labs postback parsing', () => {
  it('extracts every field from the documented CSV payload', () => {
    const f = parsePostBack(SAMPLE)
    expect(f.ResponseCode).toBe('0')
    expect(f.PlutusTransactionReferenceID).toBe('701409')
    expect(f.TransactionNumber).toBe('ORDER-1042')
    expect(f.RRN).toBe('000020')
    expect(f.TransactionLogId).toBe('4295508003')
  })

  it("preserves Pine Labs' PaymenMode spelling", () => {
    expect(parsePostBack(SAMPLE).PaymenMode).toBe('CARD')
  })

  it('handles the urlencoded data= wrapper', () => {
    const body = 'data=' + encodeURIComponent(SAMPLE)
    const f = parsePostBackBody(body)
    expect(f.PlutusTransactionReferenceID).toBe('701409')
    expect(f.ResponseMessage).toBe('APPROVED')
  })

  it('keeps values that themselves contain an equals sign', () => {
    expect(parsePostBack('A=x=y,B=2')).toEqual({ A: 'x=y', B: '2' })
  })

  it('ignores malformed segments instead of throwing', () => {
    expect(parsePostBack('garbage,,=novalue,B=2')).toEqual({ B: '2' })
  })

  it('returns nothing identifiable for an empty body', () => {
    const f = parsePostBackBody('')
    expect(f.PlutusTransactionReferenceID).toBeUndefined()
    expect(f.TransactionNumber).toBeUndefined()
  })
})
