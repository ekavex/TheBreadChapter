// Validates a template coming from the editor (or out of the database) and
// rebuilds it field by field, so unknown keys are dropped and every value is
// within what the printer can handle. Also enforces the blocks/placeholders a
// GST bill must keep (REQUIRED_BLOCK_IDS / REQUIRED_PLACEHOLDERS).
import { placeholdersIn } from './render'
import { PAPER_DOTS, PLACEHOLDERS, REQUIRED_BLOCK_IDS, REQUIRED_PLACEHOLDERS } from './types'
import type {
  PrintTemplate, TemplateBlock, TemplateKind, TextStyle, LogoImage, BlockType,
} from './types'

export type ValidationResult =
  | { ok: true; template: PrintTemplate }
  | { ok: false; errors: string[] }

const MAX_BLOCKS = 60
const MAX_TEXT = 500
const MAX_SHORT_TEXT = 120
const MAX_LOGO_HEIGHT = 800
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const BLOCK_TYPES: BlockType[] = ['logo', 'text', 'divider', 'spacer', 'items', 'note', 'taxLines', 'upiQr', 'paymentStatus']
// Blocks that only make sense once per ticket.
const SINGLETON_TYPES: BlockType[] = ['items', 'note', 'taxLines', 'upiQr', 'paymentStatus']
const BILL_ONLY_TYPES: BlockType[] = ['taxLines', 'upiQr', 'paymentStatus']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export const BLOCK_LABEL_FOR_ERRORS: Record<string, string> = {
  gstin: 'GST number', items: 'Items', taxLines: 'CGST / SGST', total: 'Total',
  billNo: 'Bill number', date: 'Date', table: 'Table',
}

export function validateTemplate(input: unknown, kind: TemplateKind): ValidationResult {
  const errors: string[] = []
  if (!isObj(input)) return { ok: false, errors: ['Template must be an object'] }

  const paper = input.paper === '80mm' ? '80mm' : input.paper === '58mm' ? '58mm' : null
  if (!paper) errors.push('Paper width must be 58mm or 80mm')
  const font = input.font === 'A' || input.font === 'B' ? input.font : null
  if (!font) errors.push('Font must be A or B')
  const feedLines = intIn(input.feedLines, 0, 10)
  if (feedLines === null) errors.push('Blank lines at the end must be 0-10')
  const cut = typeof input.cut === 'boolean' ? input.cut : null
  if (cut === null) errors.push('Cut setting is missing')

  let logo: LogoImage | null = null
  if (input.logo != null) {
    const parsed = parseLogo(input.logo)
    if (typeof parsed === 'string') errors.push(parsed)
    else logo = parsed
  }

  const blocks: TemplateBlock[] = []
  if (!Array.isArray(input.blocks)) {
    errors.push('Blocks are missing')
  } else if (input.blocks.length > MAX_BLOCKS) {
    errors.push(`At most ${MAX_BLOCKS} blocks`)
  } else {
    const ids = new Set<string>()
    const seenSingletons = new Set<string>()
    input.blocks.forEach((raw, i) => {
      const parsed = parseBlock(raw, kind, paper ?? '58mm')
      if (typeof parsed === 'string') { errors.push(`Block ${i + 1}: ${parsed}`); return }
      if (ids.has(parsed.id)) { errors.push(`Block ${i + 1}: duplicate id "${parsed.id}"`); return }
      if (SINGLETON_TYPES.includes(parsed.type)) {
        if (seenSingletons.has(parsed.type)) { errors.push(`Block ${i + 1}: only one ${parsed.type} block allowed`); return }
        seenSingletons.add(parsed.type)
      }
      ids.add(parsed.id)
      blocks.push(parsed)
    })
  }

  if (errors.length === 0) errors.push(...requiredContentErrors(blocks, kind))
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    template: { version: 1, kind, paper: paper!, font: font!, feedLines: feedLines!, cut: cut!, logo, blocks },
  }
}

// The parts a template must keep switched on, with a reason the editor can show.
export function requiredContentErrors(blocks: TemplateBlock[], kind: TemplateKind): string[] {
  const errors: string[] = []
  const enabled = blocks.filter((b) => b.enabled)
  for (const id of REQUIRED_BLOCK_IDS[kind]) {
    if (!enabled.some((b) => b.id === id)) {
      errors.push(`"${BLOCK_LABEL_FOR_ERRORS[id] ?? id}" must stay on the ${kind === 'bill' ? 'bill (GST requirement)' : 'KOT'}`)
    }
  }
  const gstin = enabled.find((b) => b.id === 'gstin')
  if (kind === 'bill' && gstin?.type === 'text' && gstin.text.replace(/\{\w+\}/g, '').trim().length < 5) {
    errors.push('The GST number line must contain the GST number')
  }
  const used = new Set(
    enabled.flatMap((b) => (b.type === 'text' ? [...placeholdersIn(b.text), ...placeholdersIn(b.rightText)] : [])),
  )
  for (const key of REQUIRED_PLACEHOLDERS[kind]) {
    if (!used.has(key)) errors.push(`{${key}} (${BLOCK_LABEL_FOR_ERRORS[key] ?? key}) must appear in a text block that is on`)
  }
  return errors
}

function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  // Control characters would be sent to the printer as commands.
  const cleaned = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
  return cleaned.length <= max ? cleaned : null
}

function parseStyle(v: unknown): TextStyle | null {
  if (!isObj(v)) return null
  const align = v.align === 'left' || v.align === 'center' || v.align === 'right' ? v.align : null
  const size = v.size === 'normal' || v.size === 'tall' || v.size === 'wide' || v.size === 'large' ? v.size : null
  if (!align || !size || typeof v.bold !== 'boolean') return null
  return { align, bold: v.bold, size }
}

function parseBlock(raw: unknown, kind: TemplateKind, paper: '58mm' | '80mm'): TemplateBlock | string {
  if (!isObj(raw)) return 'not a block'
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null
  if (!id) return 'invalid id'
  const type = BLOCK_TYPES.find((t) => t === raw.type)
  if (!type) return 'unknown block type'
  if (kind === 'kot' && BILL_ONLY_TYPES.includes(type)) return `${type} is only for bills`
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : null
  const style = parseStyle(raw.style)
  if (enabled === null || !style) return 'missing on/off or style'
  const base = { id, enabled, style }
  const placeholderKeys = new Set(PLACEHOLDERS[kind].map((p) => p.key))

  // {rate} (half the GST %) only exists inside the CGST/SGST labels.
  const checkPlaceholders = (texts: string[], allowRate = false): string | null => {
    const unknown = texts.flatMap(placeholdersIn).filter((k) => !placeholderKeys.has(k) && !(allowRate && k === 'rate'))
    return unknown.length ? `unknown field {${unknown[0]}}` : null
  }

  switch (type) {
    case 'logo': {
      const widthDots = intIn(raw.widthDots, 16, PAPER_DOTS[paper])
      return widthDots === null ? `logo width must be 16-${PAPER_DOTS[paper]} dots` : { ...base, type, widthDots }
    }
    case 'text': {
      const text = str(raw.text, MAX_TEXT)
      const rightText = str(raw.rightText ?? '', MAX_SHORT_TEXT)
      if (text === null || rightText === null) return `text too long (max ${MAX_TEXT} characters)`
      const bad = checkPlaceholders([text, rightText])
      return bad ?? { ...base, type, text, rightText }
    }
    case 'divider': {
      const char = typeof raw.char === 'string' && /^[\x21-\x7e]$/.test(raw.char) ? raw.char : null
      return char ? { ...base, type, char } : 'divider character must be one visible character'
    }
    case 'spacer': {
      const lines = intIn(raw.lines, 1, 10)
      return lines === null ? 'blank space must be 1-10 lines' : { ...base, type, lines }
    }
    case 'items': {
      if (typeof raw.showPrices !== 'boolean' || typeof raw.showAddons !== 'boolean') return 'items options missing'
      return { ...base, type, showPrices: raw.showPrices, showAddons: raw.showAddons }
    }
    case 'note': {
      const label = str(raw.label, MAX_SHORT_TEXT)
      if (label === null || typeof raw.labelOnOwnLine !== 'boolean' || typeof raw.dividerAbove !== 'boolean') return 'note options missing'
      return { ...base, type, label, labelOnOwnLine: raw.labelOnOwnLine, dividerAbove: raw.dividerAbove }
    }
    case 'taxLines': {
      const cgstLabel = str(raw.cgstLabel, MAX_SHORT_TEXT)
      const sgstLabel = str(raw.sgstLabel, MAX_SHORT_TEXT)
      if (cgstLabel === null || sgstLabel === null || typeof raw.dividerBelow !== 'boolean') return 'tax options missing'
      const bad = checkPlaceholders([cgstLabel, sgstLabel], true)
      return bad ?? { ...base, type, cgstLabel, sgstLabel, dividerBelow: raw.dividerBelow }
    }
    case 'upiQr': {
      const heading = str(raw.heading, MAX_SHORT_TEXT)
      const qrSize = intIn(raw.qrSize, 1, 8)
      if (heading === null || qrSize === null || typeof raw.showAmount !== 'boolean') return 'QR options missing (size 1-8)'
      return { ...base, type, heading, qrSize, showAmount: raw.showAmount }
    }
    case 'paymentStatus': {
      const heading = str(raw.heading, MAX_SHORT_TEXT)
      if (heading === null || typeof raw.showMode !== 'boolean' || typeof raw.showRef !== 'boolean' || typeof raw.showAmount !== 'boolean') {
        return 'payment options missing'
      }
      return { ...base, type, heading, showMode: raw.showMode, showRef: raw.showRef, showAmount: raw.showAmount }
    }
  }
}

function parseLogo(v: unknown): LogoImage | string {
  if (!isObj(v)) return 'Invalid logo'
  const width = intIn(v.width, 8, PAPER_DOTS['80mm'])
  const height = intIn(v.height, 1, MAX_LOGO_HEIGHT)
  if (width === null || height === null || typeof v.data !== 'string') return `Logo must be at most ${PAPER_DOTS['80mm']}×${MAX_LOGO_HEIGHT} dots`
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v.data)) return 'Logo data is not valid'
  const expectedBytes = Math.ceil(width / 8) * height
  const actualBytes = Math.floor((v.data.length * 3) / 4) - (v.data.endsWith('==') ? 2 : v.data.endsWith('=') ? 1 : 0)
  if (actualBytes !== expectedBytes) return 'Logo data does not match its size'
  return { width, height, data: v.data }
}
