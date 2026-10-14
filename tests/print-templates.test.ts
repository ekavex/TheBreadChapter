import { describe as group, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { renderTicket, base64ToBytes, wrapText } from '@/lib/printer/template/render'
import { defaultBillTemplate, defaultKotTemplate, newBlock } from '@/lib/printer/template/defaults'
import { DEFAULT_LOGO } from '@/lib/printer/template/defaultLogo'
import { validateTemplate } from '@/lib/printer/template/validate'
import type { PrintTemplate, TemplateBlock, TicketData } from '@/lib/printer/template/types'
import { decodeEscPos, describe } from './helpers/escpos-decode'

const billItems = [
  { name: 'Cold Brew', quantity: 2, subtotal: 360, addons: ['Oat milk'] },
  { name: 'Avocado Toast with Poached Egg and Microgreens on Sourdough', quantity: 1, subtotal: 320, addons: [] },
]
const kotItems = [
  { name: 'Cold Brew', quantity: 2, addons: ['Oat milk', 'Less ice'] },
  { name: 'Chocolate Croissant', quantity: 12, addons: [] },
]
const base: TicketData = {
  tableLabel: 'Indoor 4', station: null, orderNumber: 'ORD-0042', orderId: '00000000-0000-0000-0000-00000000a1b2',
  billNumber: 'TBC/26-27/0001', staffName: 'Ravi', fssaiNumber: '12345678901234',
  printedAt: new Date('2026-10-07T08:05:00Z'), // 13:35 IST
  items: billItems, note: 'Less sugar please', subtotalPaisa: 68000, taxPaisa: 3400, serviceChargePaisa: 0, totalPaisa: 71400,
  upiUrl: 'upi://pay?pa=x@y&am=714.00', paid: false, paymentMode: null, paymentRef: null,
}
const lines = (t: PrintTemplate, d: TicketData) => describe(decodeEscPos(renderTicket(t, d, DEFAULT_LOGO).bytes))
const texts = (t: PrintTemplate, d: TicketData) =>
  decodeEscPos(renderTicket(t, d, DEFAULT_LOGO).bytes).flatMap((l) => (l.kind === 'text' ? [l.text] : []))
const withBlock = (t: PrintTemplate, id: string, patch: Partial<TemplateBlock>): PrintTemplate =>
  ({ ...t, blocks: t.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as TemplateBlock) : b)) })

// The default layouts must print what the Android app printed before layouts
// were editable. Fixtures are the old app's EscPosHelper output for the same
// orders (captured without its logo, which a JVM test can't load).
group('default templates match the legacy Android print', () => {
  const fixture = (name: string) =>
    describe(decodeEscPos(base64ToBytes(readFileSync(join(__dirname, 'fixtures/android-legacy', `${name}.b64`), 'utf8'))))
  // The old app stamped the phone's clock.
  const normalise = (ls: string[]) => ls.map((l) => l.replace(/\d\d:\d\d/g, 'HH:MM').replace(/\d\d\/\d\d\/\d\d/g, 'DD/MM/YY'))
  // One intended change: bill add-ons keep their indent (the old wrapping dropped it).
  const legacyAddonIndent = (ls: string[]) => ls.map((l) => l.replace(/^(l---b\|)\+ /, '$1  + '))
  const noLogo = (t: PrintTemplate): PrintTemplate => ({ ...t, blocks: t.blocks.filter((b) => b.type !== 'logo') })

  it('unpaid bill', () => {
    expect(normalise(lines(noLogo(defaultBillTemplate()), base))).toEqual(normalise(legacyAddonIndent(fixture('bill_unpaid'))))
  })
  it('paid bill without FSSAI', () => {
    const data = { ...base, billNumber: 'TBC/26-27/0002', orderNumber: 'ORD-0043', fssaiNumber: null, note: null, paid: true, paymentMode: 'CARD', paymentRef: 'PL-TXN-778899' }
    expect(normalise(lines(noLogo(defaultBillTemplate()), data))).toEqual(normalise(legacyAddonIndent(fixture('bill_paid'))))
  })
  it('KOT with note and staff', () => {
    const data = { ...base, station: 'beverage_counter', items: kotItems, billNumber: null }
    expect(normalise(lines(defaultKotTemplate(), data))).toEqual(normalise(fixture('kot_note')))
  })
  it('KOT without note or staff', () => {
    const data = { ...base, tableLabel: 'Outdoor 1', orderId: '00000000-0000-0000-0000-00000000c3d4', station: 'kitchen', items: kotItems, note: null, staffName: null, billNumber: null }
    expect(normalise(lines(defaultKotTemplate(), data))).toEqual(normalise(fixture('kot_plain')))
  })
  it('prints the built-in logo at the old size', () => {
    expect(lines(defaultBillTemplate(), base)[0]).toBe('[image 264x193]')
  })
})

group('rendering', () => {
  it('uses cafe time (IST) for date and time', () => {
    const t = texts(defaultBillTemplate(), base)
    expect(t).toContain('Bill No: TBC/26-27/0001           07/10/26')
    expect(t).toContain('Order No: ORD-0042                   13:35')
  })

  it('skips a text block whose fields are all empty', () => {
    const t = texts(defaultBillTemplate(), { ...base, fssaiNumber: null, staffName: null })
    expect(t.some((l) => l.startsWith('FSSAI'))).toBe(false)
    expect(t.some((l) => l.startsWith('Staff'))).toBe(false)
  })

  it('shows the UPI QR when unpaid and payment details when paid', () => {
    const unpaid = lines(defaultBillTemplate(), base)
    expect(unpaid.some((l) => l.startsWith('[qr m4 upi://'))).toBe(true)
    expect(unpaid.some((l) => l.includes('PAYMENT SUCCESSFUL'))).toBe(false)
    const paid = lines(defaultBillTemplate(), { ...base, paid: true, paymentMode: 'UPI', paymentRef: '4298' })
    expect(paid.some((l) => l.startsWith('[qr'))).toBe(false)
    expect(paid).toContain('cBT-b|PAYMENT SUCCESSFUL')
    expect(paid).toContain('c---b|Ref: 4298')
  })

  it('moves, restyles and hides blocks', () => {
    const t = defaultBillTemplate()
    const total = t.blocks.find((b) => b.id === 'total')!
    const moved: PrintTemplate = { ...t, blocks: [total, ...t.blocks.filter((b) => b !== total && b.id !== 'logo')] }
    const out = lines(withBlock(moved, 'total', { style: { align: 'right', bold: false, size: 'large' } }), base)
    expect(out[0]).toBe('r-TWb|TOTAL      Rs. 714.00') // large = double width: 21 columns on 58mm font B
    expect(lines(withBlock(t, 'cafeName', { enabled: false }), base)).not.toContain('cB--b|THE BREAD CHAPTER')
  })

  it('fits wide text and 80mm paper to the right number of columns', () => {
    const t = { ...defaultKotTemplate(), paper: '80mm' as const }
    const divider = texts(t, { ...base, items: kotItems }).find((l) => l.startsWith('---'))
    expect(divider).toHaveLength(48)
  })

  it('wraps words and keeps indentation', () => {
    expect(wrapText('     + extra hot oat milk please', 16)).toEqual(['     + extra hot', '     oat milk', '     please'])
    expect(wrapText('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic'])
  })

  it('renders a custom text block with fields on both sides', () => {
    const t = defaultKotTemplate()
    const block = { ...newBlock('text', t.blocks.map((b) => b.id)), text: 'Waiter: {staff}', rightText: '{orderNo}', style: { align: 'left' as const, bold: false, size: 'normal' as const } }
    const out = texts({ ...t, blocks: [block, ...t.blocks] }, { ...base, items: kotItems })
    expect(out[0]).toBe('Waiter: Ravi            ORD-0042')
  })

  it('prints a custom logo, scaled down to the block width', () => {
    const logo = { width: 16, height: 4, data: btoa(String.fromCharCode(...new Array(8).fill(0xff))) }
    const t = { ...defaultBillTemplate(), logo }
    expect(lines(withBlock(t, 'logo', { widthDots: 8 } as Partial<TemplateBlock>), base)[0]).toBe('[image 8x2]')
  })
})

group('validation', () => {
  it('accepts the defaults', () => {
    expect(validateTemplate(defaultBillTemplate(), 'bill').ok).toBe(true)
    expect(validateTemplate(defaultKotTemplate(), 'kot').ok).toBe(true)
  })

  it('keeps GST-required parts of the bill switched on', () => {
    const r = validateTemplate(withBlock(defaultBillTemplate(), 'taxLines', { enabled: false }), 'bill')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/CGST \/ SGST.*must stay on/)
  })

  it('requires the bill number and date fields somewhere on the bill', () => {
    const r = validateTemplate(withBlock(defaultBillTemplate(), 'billNo', { text: 'Invoice', rightText: '' } as Partial<TemplateBlock>), 'bill')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.join()).toMatch(/\{billNo\}/)
      expect(r.errors.join()).toMatch(/\{date\}/)
    }
  })

  it('rejects unknown fields, bill-only blocks on a KOT, and bad values', () => {
    expect(validateTemplate(withBlock(defaultBillTemplate(), 'footer', { text: 'Hi {nope}' } as Partial<TemplateBlock>), 'bill').ok).toBe(false)
    const kot = defaultKotTemplate()
    expect(validateTemplate({ ...kot, blocks: [...kot.blocks, defaultBillTemplate().blocks.find((b) => b.id === 'upiQr')] }, 'kot').ok).toBe(false)
    expect(validateTemplate({ ...kot, feedLines: 99 }, 'kot').ok).toBe(false)
    expect(validateTemplate({ ...kot, logo: { width: 16, height: 4, data: 'AAAA' } }, 'kot').ok).toBe(false)
  })

  it('strips control characters so text cannot inject printer commands', () => {
    const r = validateTemplate(withBlock(defaultBillTemplate(), 'footer', { text: 'Hi\u001b@there' } as Partial<TemplateBlock>), 'bill')
    expect(r.ok && r.template.blocks.find((b) => b.id === 'footer')).toMatchObject({ text: 'Hi@there' })
  })

  it('drops unknown keys', () => {
    const r = validateTemplate({ ...defaultKotTemplate(), evil: true, blocks: defaultKotTemplate().blocks.map((b) => ({ ...b, extra: 1 })) }, 'kot')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.template).not.toHaveProperty('evil')
      expect(r.template.blocks[0]).not.toHaveProperty('extra')
    }
  })
})
