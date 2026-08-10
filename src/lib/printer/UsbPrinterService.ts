import { open, access } from 'fs/promises'
import { constants } from 'fs'
import type { PrinterService, KotTicket } from './types'

const O_NOCTTY: number = (constants as Record<string, number>)['O_NOCTTY'] ?? 0

const ESC = 0x1b
const GS  = 0x1d

const CMD = {
  INIT:          Buffer.from([ESC, 0x40]),
  ALIGN_CENTER:  Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  BOLD_ON:       Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:      Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_HEIGHT: Buffer.from([ESC, 0x21, 0x10]),
  NORMAL_SIZE:   Buffer.from([ESC, 0x21, 0x00]),
  FULL_CUT:      Buffer.from([GS,  0x56, 0x00]),
}

const COLS = 32
const DIV  = '-'.repeat(COLS)

function feed(n: number): Buffer { return Buffer.from([ESC, 0x64, n]) }
function text(s: string): Buffer { return Buffer.from(s + '\n', 'utf8') }

function buildPayload(ticket: KotTicket): Buffer {
  const time    = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const shortId = ticket.orderId.slice(-6).toUpperCase()
  const label   = ticket.station === 'kitchen' ? '** KITCHEN **' : '** BEVERAGE **'

  const parts: Buffer[] = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_HEIGHT,
    text(label),
    CMD.NORMAL_SIZE,
    CMD.BOLD_OFF,
    text(`Table: ${ticket.tableNumber}  ${time}`),
    text(`Order #${shortId}`),
    text(DIV),
    CMD.ALIGN_LEFT,
  ]

  for (const item of ticket.items) {
    const prefix = `${String(item.quantity).padStart(2)}x  `
    const name   = item.name.slice(0, COLS - prefix.length)
    parts.push(CMD.BOLD_ON)
    parts.push(text(prefix + name))
    parts.push(CMD.BOLD_OFF)
  }

  parts.push(CMD.ALIGN_CENTER)
  parts.push(text(DIV))
  parts.push(feed(4))
  parts.push(CMD.FULL_CUT)

  return Buffer.concat(parts)
}

// Writes raw ESC/POS bytes directly to a USB printer character device
// (e.g. /dev/usb/lp0). No pairing or binding required — just plug in the cable.
export class UsbPrinterService implements PrinterService {
  constructor(
    private readonly stationDevices: Partial<Record<string, string>>
  ) {}

  async printTicket(ticket: KotTicket): Promise<void> {
    const device = this.stationDevices[ticket.station]
    if (!device) return

    try {
      await access(device, constants.F_OK)
    } catch {
      throw new Error(
        `USB printer at ${device} not found — is the cable connected and the printer on?`
      )
    }

    const fh = await open(device, constants.O_WRONLY | O_NOCTTY)
    try {
      await fh.write(buildPayload(ticket))
    } finally {
      await fh.close()
    }
  }
}
