import { describe, it, expect } from 'vitest'
import { financialYearLabel, formatBillNumber } from '@/lib/billNumber'

describe('financialYearLabel', () => {
  it('starts a new financial year on 1 April in cafe time (IST)', () => {
    // 31 Mar 2026 23:59 IST
    expect(financialYearLabel(new Date('2026-03-31T18:29:00Z'))).toBe('25-26')
    // 1 Apr 2026 00:30 IST - still 31 Mar in UTC
    expect(financialYearLabel(new Date('2026-03-31T19:00:00Z'))).toBe('26-27')
    expect(financialYearLabel(new Date('2026-10-05T12:00:00Z'))).toBe('26-27')
    expect(financialYearLabel(new Date('2027-01-15T12:00:00Z'))).toBe('26-27')
  })

  it('handles the century rollover', () => {
    expect(financialYearLabel(new Date('2099-06-01T00:00:00Z'))).toBe('99-00')
  })
})

describe('formatBillNumber', () => {
  it('zero-pads to four digits and grows past them', () => {
    expect(formatBillNumber('26-27', 1)).toBe('TBC/26-27/0001')
    expect(formatBillNumber('26-27', 12345)).toBe('TBC/26-27/12345')
  })
})
