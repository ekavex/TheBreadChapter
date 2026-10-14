// Customisable print layouts for the customer bill and the KOT (kitchen
// ticket). A template is an ordered list of blocks; each block can be turned
// on/off, moved, and styled. The same template drives the ESC/POS bytes sent
// to the printer and the live preview in the dashboard editor (see render.ts),
// so the two can never disagree.

export type TemplateKind = 'bill' | 'kot'
export type Align = 'left' | 'center' | 'right'
// tall = double height, wide = double width (half the columns), large = both.
export type TextSize = 'normal' | 'tall' | 'wide' | 'large'
// Font A = regular (32 cols on 58mm), Font B = condensed (42 cols on 58mm).
export type PrinterFont = 'A' | 'B'
export type PaperWidth = '58mm' | '80mm'

export interface TextStyle {
  align: Align
  bold: boolean
  size: TextSize
}

interface BlockBase {
  id: string
  enabled: boolean
  style: TextStyle
}

export interface LogoBlock extends BlockBase {
  type: 'logo'
  widthDots: number
}

// Free text with {placeholders}; rightText (optional) is printed right-aligned
// on the same row. The block is skipped when every placeholder in it is empty.
export interface TextBlock extends BlockBase {
  type: 'text'
  text: string
  rightText: string
}

export interface DividerBlock extends BlockBase {
  type: 'divider'
  char: string
}

export interface SpacerBlock extends BlockBase {
  type: 'spacer'
  lines: number
}

export interface ItemsBlock extends BlockBase {
  type: 'items'
  showPrices: boolean
  showAddons: boolean
}

export interface NoteBlock extends BlockBase {
  type: 'note'
  label: string
  labelOnOwnLine: boolean
  dividerAbove: boolean
}

export interface TaxLinesBlock extends BlockBase {
  type: 'taxLines'
  cgstLabel: string // {rate} = half the GST %
  sgstLabel: string
  dividerBelow: boolean
}

export interface UpiQrBlock extends BlockBase {
  type: 'upiQr'
  heading: string
  qrSize: number // dots per QR module, 1-8
  showAmount: boolean
}

export interface PaymentStatusBlock extends BlockBase {
  type: 'paymentStatus'
  heading: string
  showMode: boolean
  showRef: boolean
  showAmount: boolean
}

export type TemplateBlock =
  | LogoBlock
  | TextBlock
  | DividerBlock
  | SpacerBlock
  | ItemsBlock
  | NoteBlock
  | TaxLinesBlock
  | UpiQrBlock
  | PaymentStatusBlock

export type BlockType = TemplateBlock['type']

// 1-bit image, rows packed MSB-first, ceil(width/8) bytes per row, base64.
export interface LogoImage {
  width: number
  height: number
  data: string
}

export interface PrintTemplate {
  version: 1
  kind: TemplateKind
  paper: PaperWidth
  font: PrinterFont
  blocks: TemplateBlock[]
  feedLines: number
  cut: boolean
  // Custom logo uploaded in the editor; null = the built-in logo.
  logo: LogoImage | null
}

export interface TicketItem {
  name: string
  quantity: number
  subtotal?: number // rupees, bill only
  addons: string[]
}

// Everything a template can print. Fields a ticket doesn't have are left
// empty/null, which hides the blocks that need them.
export interface TicketData {
  tableLabel: string
  station: string | null // 'kitchen' | 'beverage_counter' (KOT)
  orderNumber: string | null
  orderId: string
  billNumber: string | null
  staffName: string | null
  fssaiNumber: string | null
  printedAt: Date
  items: TicketItem[]
  note: string | null
  subtotalPaisa: number
  taxPaisa: number
  serviceChargePaisa: number
  totalPaisa: number
  upiUrl: string | null
  paid: boolean
  paymentMode: string | null
  paymentRef: string | null
}

export const PAPER_DOTS: Record<PaperWidth, number> = { '58mm': 384, '80mm': 576 }

export const FONT_COLUMNS: Record<PaperWidth, Record<PrinterFont, number>> = {
  '58mm': { A: 32, B: 42 },
  '80mm': { A: 48, B: 64 },
}

export const PLACEHOLDERS: Record<TemplateKind, { key: string; description: string }[]> = {
  bill: [
    { key: 'table', description: 'Table name' },
    { key: 'billNo', description: 'Bill number (TBC/26-27/0001)' },
    { key: 'orderNo', description: 'Order number (ORD-0042)' },
    { key: 'shortId', description: 'Short order code' },
    { key: 'staff', description: 'Waiter who took the order' },
    { key: 'date', description: 'Date (dd/mm/yy)' },
    { key: 'time', description: 'Time (hh:mm)' },
    { key: 'fssai', description: 'FSSAI number (Admin → Bill Details)' },
    { key: 'subtotal', description: 'Subtotal, e.g. 160.00' },
    { key: 'tax', description: 'Total GST, e.g. 8.00' },
    { key: 'serviceCharge', description: 'Service charge (empty when 0)' },
    { key: 'total', description: 'Bill total, e.g. 168.00' },
    { key: 'itemCount', description: 'Item count, e.g. 3 items' },
    { key: 'paymentMode', description: 'UPI / CARD / CASH (paid bills)' },
    { key: 'paymentRef', description: 'Payment reference (paid bills)' },
  ],
  kot: [
    { key: 'table', description: 'Table name' },
    { key: 'station', description: 'KITCHEN or BARISTA' },
    { key: 'orderNo', description: 'Order number (ORD-0042)' },
    { key: 'shortId', description: 'Short order code' },
    { key: 'staff', description: 'Waiter who sent the KOT' },
    { key: 'date', description: 'Date (dd/mm/yy)' },
    { key: 'time', description: 'Time (hh:mm)' },
    { key: 'itemCount', description: 'Item count, e.g. 3 items' },
  ],
}

// Blocks that must stay on (they can still be moved, restyled and reworded)
// and placeholders that must stay in some enabled text block. For the bill
// these are what a GST tax invoice has to show.
export const REQUIRED_BLOCK_IDS: Record<TemplateKind, string[]> = {
  bill: ['gstin', 'items', 'taxLines', 'total'],
  kot: ['items'],
}
export const REQUIRED_PLACEHOLDERS: Record<TemplateKind, string[]> = {
  bill: ['billNo', 'date', 'total'],
  kot: ['table'],
}
