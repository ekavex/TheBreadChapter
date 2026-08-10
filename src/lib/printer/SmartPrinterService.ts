import type { PrinterService, KotTicket } from './types'
import { buildKotPayload, writeToDevice } from './escpos'

export interface StationDevices {
  btDevice?:  string   // e.g. /dev/rfcomm0
  usbDevice?: string   // e.g. /dev/usb/lp0
}

// Per print call: tries Bluetooth RFCOMM first, falls back to USB.
// No module-level device check — discovery happens at print time so
// hot-plugging and rfcomm bind/release work without a server restart.
export class SmartPrinterService implements PrinterService {
  constructor(
    private readonly stations: Partial<Record<string, StationDevices>>
  ) {}

  async printTicket(ticket: KotTicket): Promise<void> {
    const cfg = this.stations[ticket.station]
    if (!cfg) return

    const payload = buildKotPayload(ticket)
    const tried: string[] = []

    if (cfg.btDevice) {
      try {
        await writeToDevice(cfg.btDevice, payload)
        return
      } catch {
        tried.push(`BT(${cfg.btDevice})`)
      }
    }

    if (cfg.usbDevice) {
      try {
        await writeToDevice(cfg.usbDevice, payload)
        return
      } catch {
        tried.push(`USB(${cfg.usbDevice})`)
      }
    }

    if (tried.length > 0) {
      throw new Error(
        `${ticket.station} printer not reachable — tried ${tried.join(', ')}. ` +
        `Check that the printer is on and the cable/Bluetooth is connected.`
      )
    }
  }
}
