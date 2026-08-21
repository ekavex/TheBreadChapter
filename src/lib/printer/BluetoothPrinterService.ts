import { open, access } from 'fs/promises'
import { constants } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PrinterService, KotTicket } from './types'

// execFile, never exec: the MAC and device index can come from admin-editable
// configuration, and a shell would happily run `; rm -rf /` inside them.
const execFileAsync = promisify(execFile)

const MAC_PATTERN = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/
const RFCOMM_DEVICE_PATTERN = /^\/dev\/rfcomm\d{1,3}$/

// O_NOCTTY is POSIX-only — prevents the RFCOMM device becoming the process's
// controlling terminal. Falls back to 0 on platforms that don't define it.
const O_NOCTTY: number = (constants as Record<string, number>)['O_NOCTTY'] ?? 0

// ─── ESC/POS command bytes ────────────────────────────────────────────
const ESC = 0x1b
const GS  = 0x1d

const CMD = {
  INIT:           Buffer.from([ESC, 0x40]),
  ALIGN_CENTER:   Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_LEFT:     Buffer.from([ESC, 0x61, 0x00]),
  BOLD_ON:        Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:       Buffer.from([ESC, 0x45, 0x00]),
  // Double-height text (width stays single — fine on 58mm, saves space)
  DOUBLE_HEIGHT:  Buffer.from([ESC, 0x21, 0x10]),
  NORMAL_SIZE:    Buffer.from([ESC, 0x21, 0x00]),
  FULL_CUT:       Buffer.from([GS,  0x56, 0x00]),
}

// 58 mm paper = 32 printable character columns at normal size
const COLS = 32
const DIV  = '-'.repeat(COLS) + '\n'

function feed(n: number): Buffer { return Buffer.from([ESC, 0x64, n]) }
function text(s: string): Buffer { return Buffer.from(s + '\n', 'utf8') }

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length)
}

function buildPayload(ticket: KotTicket): Buffer {
  const time     = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const shortId  = ticket.orderId.slice(-6).toUpperCase()
  const label    = ticket.station === 'kitchen' ? '** KITCHEN **' : '** BEVERAGE **'

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
    text(DIV.trimEnd()),
    CMD.ALIGN_LEFT,
  ]

  for (const item of ticket.items) {
    // "3x  " prefix = 4 chars; remaining = COLS - 4 for item name
    const prefix = `${String(item.quantity).padStart(2)}x  `
    const name   = padRight(item.name, COLS - prefix.length)
    parts.push(CMD.BOLD_ON)
    parts.push(text(prefix + name))
    parts.push(CMD.BOLD_OFF)
  }

  parts.push(CMD.ALIGN_CENTER)
  parts.push(text(DIV.trimEnd()))
  parts.push(feed(4))
  parts.push(CMD.FULL_CUT)

  return Buffer.concat(parts)
}

// ─── Device helpers ───────────────────────────────────────────────────

async function deviceExists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true }
  catch { return false }
}

// Extracts the number from /dev/rfcommN
function rfcommIndex(device: string): string {
  return device.replace(/^.*rfcomm/, '')
}

// ─── Service ──────────────────────────────────────────────────────────

export interface BluetoothStationConfig {
  device: string     // e.g. /dev/rfcomm0
  mac?:   string     // e.g. AA:BB:CC:DD:EE:FF — triggers auto-bind if device is missing
  channel?: number   // SPP channel — almost always 1
}

export class BluetoothPrinterService implements PrinterService {
  constructor(
    private readonly stations: Partial<Record<string, BluetoothStationConfig>>
  ) {}

  async printTicket(ticket: KotTicket): Promise<void> {
    const cfg = this.stations[ticket.station]
    if (!cfg) return

    await this.ensureDevice(cfg)
    await this.writeToDevice(cfg.device, buildPayload(ticket))
  }

  // If the device doesn't exist, attempt recovery.
  // USB paths (/dev/usb/lp*) — device must be plugged in; no binding possible.
  // RFCOMM paths (/dev/rfcomm*) — try `rfcomm bind` using the configured MAC.
  private async ensureDevice(cfg: BluetoothStationConfig): Promise<void> {
    if (await deviceExists(cfg.device)) return

    if (!cfg.device.includes('rfcomm')) {
      throw new Error(
        `Printer device ${cfg.device} not found — is the USB cable connected and the printer powered on?`
      )
    }

    if (!cfg.mac) {
      throw new Error(
        `Bluetooth device ${cfg.device} not found.\n` +
        `Run: sudo rfcomm bind ${rfcommIndex(cfg.device)} <PRINTER_MAC> ${cfg.channel ?? 1}`
      )
    }

    if (!RFCOMM_DEVICE_PATTERN.test(cfg.device)) {
      throw new Error(`Refusing to bind an unexpected device path: ${cfg.device}`)
    }
    if (!MAC_PATTERN.test(cfg.mac)) {
      throw new Error(`Refusing to bind an invalid Bluetooth MAC: ${cfg.mac}`)
    }

    const idx = rfcommIndex(cfg.device)
    const ch  = Number.isInteger(cfg.channel) ? Number(cfg.channel) : 1
    await execFileAsync('rfcomm', ['bind', idx, cfg.mac, String(ch)])
    // Give BlueZ ~1.5 s to establish the RFCOMM channel
    await new Promise<void>((r) => setTimeout(r, 1500))

    if (!(await deviceExists(cfg.device))) {
      throw new Error(
        `rfcomm bind succeeded but ${cfg.device} still not found.\n` +
        `Is the printer on and in range? MAC: ${cfg.mac}`
      )
    }
  }

  // Write raw ESC/POS bytes to the character device.
  // O_WRONLY | O_NOCTTY is the correct flag set for serial/RFCOMM devices.
  private async writeToDevice(device: string, payload: Buffer): Promise<void> {
    const fh = await open(device, constants.O_WRONLY | O_NOCTTY)
    try {
      await fh.write(payload)
    } finally {
      await fh.close()
    }
  }
}
