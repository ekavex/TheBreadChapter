// Default layouts. These reproduce the bill and KOT exactly as the Android app
// printed them before layouts became editable, so nothing changes on paper
// until someone edits a template. "Reset to default" restores these.
import type { PrintTemplate, TemplateBlock, TemplateKind, TextStyle, BlockType } from './types'

const LEFT: TextStyle = { align: 'left', bold: false, size: 'normal' }
const CENTER: TextStyle = { align: 'center', bold: false, size: 'normal' }
const CENTER_BOLD: TextStyle = { align: 'center', bold: true, size: 'normal' }

const text = (id: string, value: string, style: TextStyle, rightText = ''): TemplateBlock =>
  ({ id, type: 'text', enabled: true, style, text: value, rightText })
const divider = (id: string, style: TextStyle = CENTER): TemplateBlock =>
  ({ id, type: 'divider', enabled: true, style, char: '-' })

export function defaultBillTemplate(): PrintTemplate {
  return {
    version: 1,
    kind: 'bill',
    paper: '58mm',
    font: 'B',
    feedLines: 4,
    cut: true,
    logo: null,
    blocks: [
      { id: 'logo', type: 'logo', enabled: true, style: CENTER, widthDots: 264 },
      text('cafeName', 'THE BREAD CHAPTER', CENTER_BOLD),
      text('legalName', 'The Bread Chapter (ANV HOSPITALITY PVT. LTD)', CENTER),
      text('gstin', 'GST NO - 27ABFCA1460M1ZK', CENTER),
      text('fssai', 'FSSAI NO - {fssai}', CENTER),
      text('address', 'ADDRESS - VEDAS CENTRE DP ROAD NR SHIV SAGAR AUNDH PUNE, Aundh, Pune Municipal Corporation, Maharashtra - 411007', CENTER),
      divider('divHeader'),
      text('table', 'Table: {table}', CENTER_BOLD),
      text('billNo', 'Bill No: {billNo}', LEFT, '{date}'),
      text('orderNo', 'Order No: {orderNo}', LEFT, '{time}'),
      text('staff', 'Staff: {staff}', LEFT),
      divider('divItems'),
      { id: 'items', type: 'items', enabled: true, style: LEFT, showPrices: true, showAddons: true },
      { id: 'note', type: 'note', enabled: true, style: { ...LEFT, bold: true }, label: 'Note:', labelOnOwnLine: false, dividerAbove: false },
      divider('divTotals'),
      // Subtotal and footer are available but off by default, so today's
      // printed bill stays unchanged until someone turns them on.
      { ...text('subtotal', 'Subtotal', LEFT, 'Rs. {subtotal}'), enabled: false },
      { id: 'taxLines', type: 'taxLines', enabled: true, style: LEFT, cgstLabel: '{rate}% CGST', sgstLabel: '{rate}% SGST', dividerBelow: true },
      text('serviceCharge', 'Service charge', LEFT, 'Rs. {serviceCharge}'),
      text('total', 'TOTAL', { align: 'left', bold: true, size: 'tall' }, 'Rs. {total}'),
      divider('divPayment'),
      { id: 'upiQr', type: 'upiQr', enabled: true, style: CENTER_BOLD, heading: 'Scan & Pay via UPI', qrSize: 4, showAmount: true },
      { id: 'paymentStatus', type: 'paymentStatus', enabled: true, style: { align: 'center', bold: true, size: 'tall' }, heading: 'PAYMENT SUCCESSFUL', showMode: true, showRef: true, showAmount: true },
      divider('divEnd'),
      { ...text('footer', 'Thank you! Visit again', CENTER), enabled: false },
    ],
  }
}

export function defaultKotTemplate(): PrintTemplate {
  return {
    version: 1,
    kind: 'kot',
    paper: '58mm',
    font: 'A',
    feedLines: 4,
    cut: true,
    logo: null,
    blocks: [
      { id: 'station', type: 'text', enabled: false, style: { align: 'center', bold: true, size: 'tall' }, text: '** {station} **', rightText: '' },
      text('table', 'TABLE: {table}', { align: 'center', bold: true, size: 'large' }),
      text('timeRef', '{time}  #{shortId}', CENTER),
      divider('divItems'),
      { id: 'items', type: 'items', enabled: true, style: { align: 'left', bold: true, size: 'tall' }, showPrices: false, showAddons: true },
      { id: 'note', type: 'note', enabled: true, style: { ...LEFT, bold: true }, label: 'NOTE:', labelOnOwnLine: true, dividerAbove: true },
      divider('divEnd'),
      text('staff', 'Order taken by {staff}', CENTER),
      text('itemCount', 'Total: {itemCount}', CENTER_BOLD),
    ],
  }
}

export function defaultTemplate(kind: TemplateKind): PrintTemplate {
  return kind === 'bill' ? defaultBillTemplate() : defaultKotTemplate()
}

// Names shown in the editor's block list.
export const BLOCK_TYPE_LABEL: Record<BlockType, string> = {
  logo: 'Logo',
  text: 'Text',
  divider: 'Divider line',
  spacer: 'Blank space',
  items: 'Items',
  note: 'Customer note',
  taxLines: 'CGST / SGST',
  upiQr: 'UPI QR (unpaid bills)',
  paymentStatus: 'Payment successful (paid bills)',
}

// Block types the editor's "Add" menu can create (the others exist once).
export const ADDABLE_BLOCK_TYPES: BlockType[] = ['text', 'divider', 'spacer', 'logo']

export function newBlock(type: BlockType, existingIds: string[]): TemplateBlock {
  let n = 1
  while (existingIds.includes(`${type}${n}`)) n++
  const id = `${type}${n}`
  switch (type) {
    case 'text': return { id, type, enabled: true, style: CENTER, text: 'New text', rightText: '' }
    case 'divider': return { id, type, enabled: true, style: CENTER, char: '-' }
    case 'spacer': return { id, type, enabled: true, style: LEFT, lines: 1 }
    case 'logo': return { id, type, enabled: true, style: CENTER, widthDots: 264 }
    default: throw new Error(`Block type ${type} can't be added`)
  }
}
