// Bill (invoice) numbering: TBC/26-27/0001 - a running series per Indian
// financial year (1 April - 31 March), separate from the order number
// (ORD-0042). Assigned once, when an order is first billed, from the
// bill_number_counters table inside the billing transaction, so the series
// has no gaps and a number is never reused.
import type postgres from 'postgres'

export const BILL_NUMBER_PREFIX = 'TBC'
const CAFE_TIME_ZONE = 'Asia/Kolkata'

// "26-27" for any date from 1 Apr 2026 to 31 Mar 2027, judged in cafe time
// (so a bill at 00:30 IST on 1 April belongs to the new year).
export function financialYearLabel(date: Date, timeZone: string = CAFE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const startYear = month >= 4 ? year : year - 1
  const yy = (y: number) => String(y % 100).padStart(2, '0')
  return `${yy(startYear)}-${yy(startYear + 1)}`
}

export function formatBillNumber(financialYear: string, sequence: number): string {
  return `${BILL_NUMBER_PREFIX}/${financialYear}/${String(sequence).padStart(4, '0')}`
}

// Takes the next number in this financial year's series. Must run inside the
// same transaction that writes it onto the order: if that transaction rolls
// back, the counter increment rolls back with it.
export async function nextBillNumber(
  tx: postgres.TransactionSql<Record<string, never>>,
  cafeId: string,
  now: Date = new Date(),
): Promise<string> {
  const financialYear = financialYearLabel(now)
  const [row] = await tx`
    INSERT INTO bill_number_counters (cafe_id, financial_year, last_value)
    VALUES (${cafeId}, ${financialYear}, 1)
    ON CONFLICT (cafe_id, financial_year)
    DO UPDATE SET last_value = bill_number_counters.last_value + 1
    RETURNING last_value
  `
  return formatBillNumber(financialYear, Number(row.last_value))
}
