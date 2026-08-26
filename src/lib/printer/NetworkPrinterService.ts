import net from 'net'
import type { PrinterService, KotTicket } from './types'

// ESC/POS byte sequences — standard across most 80mm/58mm thermal printers.
const ESC = 0x1b
const GS = 0x1d

const CMD = {
  INIT:            Buffer.from([ESC, 0x40]),
  ALIGN_CENTER:    Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_LEFT:      Buffer.from([ESC, 0x61, 0x00]),
  BOLD_ON:         Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:        Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_HEIGHT:   Buffer.from([ESC, 0x21, 0x10]),
  NORMAL_SIZE:     Buffer.from([ESC, 0x21, 0x00]),
  FULL_CUT:        Buffer.from([GS,  0x56, 0x00]),
}

function feed(lines: number): Buffer { return Buffer.from([ESC, 0x64, lines]) }
function text(s: string): Buffer { return Buffer.from(s + '\n', 'utf8') }

// Sends a KOT over raw TCP (port 9100) to the printer's IP address.
// Instantiate with a map of station → IP; stations with no IP are skipped silently.
export class NetworkPrinterService implements PrinterService {
  constructor(
    private readonly stationIps: Partial<Record<string, string>>,
    private readonly port: number = 9100,
    private readonly timeoutMs: number = 5000,
  ) {}

  async printTicket(ticket: KotTicket): Promise<void> {
    const ip = this.stationIps[ticket.station]
    if (!ip) return

    const time = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    const shortId = ticket.orderId.slice(-6).toUpperCase()
    const div = '--------------------------------'

    const parts: Buffer[] = [
      CMD.INIT,
      CMD.ALIGN_CENTER,
      CMD.BOLD_ON,
      CMD.DOUBLE_HEIGHT,
      text(ticket.station === 'kitchen' ? '** BARISTA **' : '** BEVERAGE **'),
      CMD.NORMAL_SIZE,
      CMD.BOLD_OFF,
      text(`Table: ${ticket.tableLabel}   ${time}`),
      text(`Order: #${shortId}`),
      text(div),
      CMD.ALIGN_LEFT,
    ]

    for (const item of ticket.items) {
      parts.push(CMD.BOLD_ON)
      parts.push(text(`${String(item.quantity).padEnd(3)} ${item.name}`))
      parts.push(CMD.BOLD_OFF)
    }

    parts.push(CMD.ALIGN_CENTER)
    parts.push(text(div))
    parts.push(feed(4))
    parts.push(CMD.FULL_CUT)

    const payload = Buffer.concat(parts)

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: ip, port: this.port }, () => {
        socket.write(payload, (err) => {
          if (err) { socket.destroy(); reject(err) }
          else socket.end(() => resolve())
        })
      })
      socket.on('error', reject)
      socket.setTimeout(this.timeoutMs, () => {
        socket.destroy()
        reject(new Error(`KOT printer at ${ip}:${this.port} timed out`))
      })
    })
  }
}
