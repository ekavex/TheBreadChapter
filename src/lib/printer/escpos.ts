// Shared ESC/POS payload builder — 58mm / 32-column thermal paper
import type { KotTicket } from './types'

const ESC = 0x1b
const GS  = 0x1d

export const CMD = {
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

export function feed(n: number): Buffer { return Buffer.from([ESC, 0x64, n]) }
export function text(s: string): Buffer { return Buffer.from(s + '\n', 'utf8') }

export function buildKotPayload(ticket: KotTicket): Buffer {
  const time    = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const shortId = ticket.orderId.slice(-6).toUpperCase()
  const label   = ticket.station === 'kitchen' ? '** BARISTA **' : '** BEVERAGE **'
  const div     = '-'.repeat(COLS)

  const parts: Buffer[] = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_HEIGHT,
    text(label),
    CMD.NORMAL_SIZE,
    CMD.BOLD_OFF,
    text(`Table: ${ticket.tableLabel}  ${time}`),
    text(`Order #${shortId}`),
    text(div),
    CMD.ALIGN_LEFT,
  ]

  for (const item of ticket.items) {
    const prefix = `${String(item.quantity).padStart(2)}x  `
    parts.push(CMD.BOLD_ON, text(prefix + item.name.slice(0, COLS - prefix.length)), CMD.BOLD_OFF)
    for (const addon of item.addons ?? []) {
      parts.push(text(`     + ${addon}`.slice(0, COLS)))
    }
  }

  if (ticket.customerNote?.trim()) {
    parts.push(text(div), CMD.BOLD_ON, text('NOTE:'), CMD.BOLD_OFF, text(ticket.customerNote.trim().slice(0, COLS * 3)))
  }

  if (ticket.takenBy?.trim()) {
    parts.push(text(div), text(`Order taken by ${ticket.takenBy.trim()}`.slice(0, COLS)))
  }

  parts.push(CMD.ALIGN_CENTER, text(div), feed(4), CMD.FULL_CUT)
  return Buffer.concat(parts)
}

export function buildTestPayload(station: string): Buffer {
  const div = '-'.repeat(COLS)
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const label = station === 'kitchen' ? '** BARISTA **' : '** BEVERAGE **'

  return Buffer.concat([
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_HEIGHT,
    text(label),
    CMD.NORMAL_SIZE,
    CMD.BOLD_OFF,
    text(`TEST PRINT  ${time}`),
    text(div),
    CMD.ALIGN_LEFT,
    CMD.BOLD_ON,
    text(' 2x  Test Item'),
    text(' 1x  Another Item'),
    CMD.BOLD_OFF,
    CMD.ALIGN_CENTER,
    text(div),
    feed(4),
    CMD.FULL_CUT,
  ])
}

// Write raw bytes to a character device (USB lp*, rfcomm*, or any serial path)
export async function writeToDevice(device: string, payload: Buffer): Promise<void> {
  const { open, access } = await import('fs/promises')
  const { constants } = await import('fs')
  const O_NOCTTY: number = (constants as Record<string, number>)['O_NOCTTY'] ?? 0

  await access(device, constants.F_OK)
  const fh = await open(device, constants.O_WRONLY | O_NOCTTY)
  try {
    await fh.write(payload)
  } finally {
    await fh.close()
  }
}
