// Renders a PrintTemplate + TicketData into ESC/POS bytes for the thermal
// printer AND a structured preview for the dashboard editor, in one pass, so
// the preview always matches the print. Pure TypeScript with no Node-only
// APIs: the editor imports this same file in the browser.
import { FONT_COLUMNS, PAPER_DOTS } from './types'
import type {
  PrintTemplate, TemplateBlock, TextStyle, TextSize, TicketData, LogoImage, TemplateKind,
} from './types'

export const CAFE_TIME_ZONE = 'Asia/Kolkata'

export type PreviewLine =
  | { kind: 'text'; text: string; align: TextStyle['align']; bold: boolean; size: TextSize }
  | { kind: 'image'; width: number; height: number; data: string; align: TextStyle['align'] }
  | { kind: 'qr'; data: string; moduleSize: number; align: TextStyle['align'] }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' }

export interface RenderedTicket {
  bytes: Uint8Array
  preview: PreviewLine[]
  columns: number // characters per line at normal width
  paperDots: number
}

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const encoder = new TextEncoder()

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(bin)
}

// ── Text helpers (mirror the original Android EscPosHelper behaviour) ──────

// Greedy word wrap; a single word longer than the line is hard-split. Leading
// indentation (e.g. "     + Oat milk") is kept on every wrapped line.
export function wrapText(s: string, cols: number): string[] {
  const indent = s.match(/^ */)![0]
  if (indent && indent.length < cols - 1) {
    return wrapText(s.slice(indent.length), cols - indent.length).map((l) => indent + l)
  }
  const lines: string[] = []
  let cur = ''
  for (const rawWord of s.split(' ')) {
    let word = rawWord
    while (word.length > cols) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(word.slice(0, cols))
      word = word.slice(cols)
    }
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= cols) {
      cur = next
    } else {
      if (cur) lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// Left + right text filling exactly `cols` characters.
export function rowLine(left: string, right: string, cols: number): string {
  const space = cols - left.length - right.length
  return space <= 0
    ? `${left.slice(0, Math.max(cols - right.length - 1, 0))} ${right}`
    : left + ' '.repeat(space) + right
}

// "<label>  <right>" on one line if it fits; otherwise the label wraps and the
// right part stays on the last line, so it's never pushed off the paper.
function pricedLines(label: string, right: string, cols: number): string[] {
  if (!right) return wrapText(label, cols)
  if (label.length + 1 + right.length <= cols) return [rowLine(label, right, cols)]
  const wrapped = wrapText(label, cols)
  const out: string[] = []
  wrapped.forEach((line, i) => {
    if (i !== wrapped.length - 1) out.push(line)
    else if (line.length + 1 + right.length <= cols) out.push(rowLine(line, right, cols))
    else { out.push(line); out.push(rowLine('', right, cols)) }
  })
  return out
}

function formatRupees(paisa: number): string {
  return (paisa / 100).toFixed(2)
}

// 2.5 for 5% GST, but plain 6 / 9 for 12% / 18%.
function formatPercent(value: number): string {
  const oneDecimal = value.toFixed(1)
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal
}

function dateParts(d: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAFE_TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { date: `${get('day')}/${get('month')}/${get('year')}`, time: `${get('hour')}:${get('minute')}` }
}

export function placeholderValues(data: TicketData, kind: TemplateKind): Record<string, string> {
  const { date, time } = dateParts(data.printedAt)
  const itemCount = data.items.reduce((s, i) => s + i.quantity, 0)
  return {
    table: data.tableLabel,
    station: data.station === 'kitchen' ? 'KITCHEN' : data.station ? 'BARISTA' : '',
    billNo: data.billNumber ?? '',
    orderNo: data.orderNumber ?? '',
    shortId: data.orderId.slice(-6).toUpperCase(),
    staff: data.staffName?.trim() ?? '',
    date,
    time,
    fssai: data.fssaiNumber?.trim() ?? '',
    subtotal: kind === 'bill' ? formatRupees(data.subtotalPaisa) : '',
    tax: kind === 'bill' && data.taxPaisa > 0 ? formatRupees(data.taxPaisa) : '',
    serviceCharge: kind === 'bill' && data.serviceChargePaisa > 0 ? formatRupees(data.serviceChargePaisa) : '',
    total: kind === 'bill' ? formatRupees(data.totalPaisa) : '',
    itemCount: `${itemCount} item${itemCount === 1 ? '' : 's'}`,
    paymentMode: data.paid ? data.paymentMode ?? '' : '',
    paymentRef: data.paid ? data.paymentRef ?? '' : '',
  }
}

const PLACEHOLDER_RE = /\{(\w+)\}/g

export function placeholdersIn(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER_RE), (m) => m[1])
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => (key in values ? values[key] : whole))
}

// ── Logo scaling (box filter + threshold, ~ the old bilinear+threshold) ────

function scaleLogo(logo: LogoImage, targetWidth: number): LogoImage {
  if (logo.width <= targetWidth) return logo
  const src = base64ToBytes(logo.data)
  const srcRow = Math.ceil(logo.width / 8)
  const ratio = logo.width / targetWidth
  const targetHeight = Math.max(1, Math.floor((logo.height * targetWidth) / logo.width))
  const dstRow = Math.ceil(targetWidth / 8)
  const dst = new Uint8Array(dstRow * targetHeight)
  const isBlack = (x: number, y: number) => (src[y * srcRow + (x >> 3)] >> (7 - (x & 7))) & 1

  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor(ty * ratio)
    const y1 = Math.min(logo.height, Math.max(y0 + 1, Math.floor((ty + 1) * ratio)))
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor(tx * ratio)
      const x1 = Math.min(logo.width, Math.max(x0 + 1, Math.floor((tx + 1) * ratio)))
      let black = 0
      let total = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { black += isBlack(x, y); total++ }
      if (black * 2 >= total) dst[ty * dstRow + (tx >> 3)] |= 0x80 >> (tx & 7)
    }
  }
  return { width: targetWidth, height: targetHeight, data: bytesToBase64(dst) }
}

// ── Writer: emits bytes and preview lines together ─────────────────────────

class TicketWriter {
  private parts: number[] = []
  readonly preview: PreviewLine[] = []
  private style: TextStyle = { align: 'left', bold: false, size: 'normal' }

  constructor(private readonly fontB: boolean, readonly baseCols: number) {}

  private push(...bytes: number[]) { this.parts.push(...bytes) }
  private pushBytes(bytes: Uint8Array) { for (let i = 0; i < bytes.length; i++) this.parts.push(bytes[i]) }

  init() { this.push(ESC, 0x40) }

  // Every style change re-sends align + print mode + bold, so no block can
  // inherit a leftover state from the one before it.
  setStyle(style: TextStyle) {
    this.style = style
    const align = style.align === 'center' ? 1 : style.align === 'right' ? 2 : 0
    const tall = style.size === 'tall' || style.size === 'large'
    const wide = style.size === 'wide' || style.size === 'large'
    const mode = (this.fontB ? 0x01 : 0) | (tall ? 0x10 : 0) | (wide ? 0x20 : 0)
    this.push(ESC, 0x61, align, ESC, 0x21, mode, ESC, 0x45, style.bold ? 1 : 0)
  }

  colsFor(size: TextSize): number {
    return size === 'wide' || size === 'large' ? Math.floor(this.baseCols / 2) : this.baseCols
  }

  get cols(): number { return this.colsFor(this.style.size) }

  line(text: string) {
    this.pushBytes(encoder.encode(text))
    this.push(LF)
    this.preview.push({ kind: 'text', text, ...this.style })
  }

  blank() { this.line('') }

  image(logo: LogoImage) {
    const bytesPerRow = Math.ceil(logo.width / 8)
    this.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, logo.height & 0xff, (logo.height >> 8) & 0xff)
    this.pushBytes(base64ToBytes(logo.data))
    this.push(LF)
    this.preview.push({ kind: 'image', width: logo.width, height: logo.height, data: logo.data, align: this.style.align })
  }

  // GS ( k: QR model 2, error correction L, printed by the printer itself.
  qr(data: string, moduleSize: number) {
    const bytes = encoder.encode(data)
    const len = bytes.length + 3
    this.push(GS, 0x28, 0x6b, 4, 0, 49, 65, 2, 0)
    this.push(GS, 0x28, 0x6b, 3, 0, 49, 67, moduleSize, 0)
    this.push(GS, 0x28, 0x6b, 3, 0, 49, 69, 48, 0)
    this.push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48)
    this.pushBytes(bytes)
    this.push(GS, 0x28, 0x6b, 3, 0, 49, 81, 48)
    this.push(LF)
    this.preview.push({ kind: 'qr', data, moduleSize, align: this.style.align })
  }

  feed(lines: number) {
    if (lines <= 0) return
    this.push(ESC, 0x64, lines)
    this.preview.push({ kind: 'feed', lines })
  }

  cut() {
    this.push(GS, 0x56, 0x00)
    this.preview.push({ kind: 'cut' })
  }

  bytes(): Uint8Array { return Uint8Array.from(this.parts) }
}

// ── Blocks ──────────────────────────────────────────────────────────────────

const PLAIN = (style: TextStyle): TextStyle => ({ align: style.align, bold: false, size: 'normal' })

function renderBlock(
  w: TicketWriter,
  block: TemplateBlock,
  data: TicketData,
  values: Record<string, string>,
  defaultLogo: LogoImage | null,
  templateLogo: LogoImage | null,
  paperDots: number,
) {
  switch (block.type) {
    case 'logo': {
      const source = templateLogo ?? defaultLogo
      if (!source) return
      w.setStyle(block.style)
      w.image(scaleLogo(source, Math.min(block.widthDots, paperDots)))
      return
    }

    case 'text': {
      const keys = [...placeholdersIn(block.text), ...placeholdersIn(block.rightText)]
      if (keys.length > 0 && keys.every((k) => !values[k])) return
      const left = fill(block.text, values)
      const right = fill(block.rightText, values)
      w.setStyle(block.style)
      const textLines = left.split('\n')
      textLines.forEach((textLine, i) => {
        const isLast = i === textLines.length - 1
        for (const l of pricedLines(textLine, isLast ? right : '', w.cols)) w.line(l)
      })
      return
    }

    case 'divider': {
      w.setStyle(block.style)
      w.line((block.char || '-').repeat(w.cols))
      return
    }

    case 'spacer': {
      w.setStyle(block.style)
      for (let i = 0; i < block.lines; i++) w.blank()
      return
    }

    case 'items': {
      for (const item of data.items) {
        w.setStyle(block.style)
        if (block.showPrices) {
          const price = `Rs. ${Math.round(item.subtotal ?? 0)}`
          for (const l of pricedLines(`${item.quantity}x ${item.name}`, price, w.cols)) w.line(l)
        } else {
          const prefix = `${String(item.quantity).padStart(2)}x  `
          w.line(prefix + item.name.slice(0, Math.max(w.cols - prefix.length, 0)))
        }
        if (block.showAddons && item.addons.length > 0) {
          w.setStyle(PLAIN(block.style))
          for (const addon of item.addons) {
            const addonLine = block.showPrices ? `  + ${addon}` : `     + ${addon}`
            for (const l of wrapText(addonLine, w.cols)) w.line(l)
          }
        }
      }
      return
    }

    case 'note': {
      const note = data.note?.trim()
      if (!note) return
      if (block.dividerAbove) {
        w.setStyle(PLAIN(block.style))
        w.line('-'.repeat(w.cols))
      }
      w.setStyle(block.style)
      if (block.labelOnOwnLine) {
        if (block.label) w.line(block.label)
        w.setStyle(PLAIN(block.style))
        for (const l of wrapText(note, w.cols)) w.line(l)
      } else {
        for (const l of wrapText(block.label ? `${block.label} ${note}` : note, w.cols)) w.line(l)
      }
      return
    }

    case 'taxLines': {
      if (data.taxPaisa <= 0) return
      const cgst = Math.floor(data.taxPaisa / 2)
      const sgst = data.taxPaisa - cgst // absorbs the odd paisa so CGST + SGST == tax
      const halfPercent = data.subtotalPaisa > 0 ? (data.taxPaisa * 100 / data.subtotalPaisa) / 2 : 0
      const rate = { ...values, rate: formatPercent(halfPercent) }
      w.setStyle(block.style)
      for (const l of pricedLines(fill(block.cgstLabel, rate), `Rs. ${formatRupees(cgst)}`, w.cols)) w.line(l)
      for (const l of pricedLines(fill(block.sgstLabel, rate), `Rs. ${formatRupees(sgst)}`, w.cols)) w.line(l)
      if (block.dividerBelow) {
        w.setStyle({ ...PLAIN(block.style), align: 'center' })
        w.line('-'.repeat(w.cols))
      }
      return
    }

    case 'upiQr': {
      if (data.paid || !data.upiUrl) return
      if (block.heading) {
        w.setStyle(block.style)
        for (const l of wrapText(fill(block.heading, values), w.cols)) w.line(l)
      }
      w.setStyle(PLAIN(block.style))
      w.blank()
      w.qr(data.upiUrl, block.qrSize)
      if (block.showAmount) {
        w.setStyle({ ...PLAIN(block.style), bold: true })
        w.line(`Rs. ${formatRupees(data.totalPaisa)}`)
      }
      return
    }

    case 'paymentStatus': {
      if (!data.paid) return
      if (block.heading) {
        w.setStyle(block.style)
        for (const l of wrapText(fill(block.heading, values), w.cols)) w.line(l)
      }
      w.setStyle(PLAIN(block.style))
      if (block.showMode && data.paymentMode) w.line(`Paid via ${data.paymentMode}`)
      if (block.showRef && data.paymentRef) {
        for (const l of wrapText(`Ref: ${data.paymentRef}`, w.cols)) w.line(l)
      }
      if (block.showAmount) {
        w.setStyle({ ...PLAIN(block.style), bold: true })
        w.line(`Rs. ${formatRupees(data.totalPaisa)}`)
      }
      return
    }
  }
}

export function renderTicket(
  template: PrintTemplate,
  data: TicketData,
  defaultLogo: LogoImage | null = null,
): RenderedTicket {
  const columns = FONT_COLUMNS[template.paper][template.font]
  const paperDots = PAPER_DOTS[template.paper]
  const w = new TicketWriter(template.font === 'B', columns)
  const values = placeholderValues(data, template.kind)

  w.init()
  for (const block of template.blocks) {
    if (!block.enabled) continue
    renderBlock(w, block, data, values, defaultLogo, template.logo, paperDots)
  }
  w.setStyle({ align: 'left', bold: false, size: 'normal' })
  w.feed(template.feedLines)
  if (template.cut) w.cut()

  return { bytes: w.bytes(), preview: w.preview, columns, paperDots }
}
