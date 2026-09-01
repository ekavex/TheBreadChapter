import type { PrinterService } from './types'
import { SmartPrinterService, type StationDevices } from './SmartPrinterService'
import { NetworkPrinterService } from './NetworkPrinterService'

export interface PrinterConfig {
  kitchen:         StationDevices & { ip?: string }
  beverage_counter: StationDevices & { ip?: string }
}

// Reads printer config from cafes.settings.printers (DB), falling back to env vars.
// Call this inside the KOT route so config changes take effect without a restart.
export async function loadPrinterConfig(
  sql: ReturnType<typeof import('@/lib/db').getDb>,
  cafeId: string
): Promise<PrinterConfig> {
  let dbPrinters: Partial<Record<string, Partial<StationDevices & { ip?: string }>>> = {}

  try {
    const [row] = await sql`SELECT settings FROM cafes WHERE id = ${cafeId}`
    dbPrinters = (row?.settings as Record<string, unknown>)?.printers as typeof dbPrinters ?? {}
  } catch {
    // DB read failure - fall through to env vars
  }

  function merge(station: string, envBt?: string, envUsb?: string, envIp?: string) {
    const db = dbPrinters[station] ?? {}
    return {
      btDevice:  db.btDevice  ?? envBt  ?? undefined,
      usbDevice: db.usbDevice ?? envUsb ?? undefined,
      ip:        db.ip        ?? envIp  ?? undefined,
    }
  }

  return {
    kitchen: merge(
      'kitchen',
      process.env.PRINTER_KITCHEN_BT_DEVICE,
      process.env.PRINTER_KITCHEN_USB_DEVICE,
      process.env.PRINTER_KITCHEN_IP,
    ),
    beverage_counter: merge(
      'beverage_counter',
      process.env.PRINTER_BEVERAGE_BT_DEVICE,
      process.env.PRINTER_BEVERAGE_USB_DEVICE,
      process.env.PRINTER_BEVERAGE_IP,
    ),
  }
}

// Builds the right service from config. Priority: Smart(BT+USB) > Network > Mock.
export function buildPrinterService(cfg: PrinterConfig): PrinterService {
  const hasNetwork = cfg.kitchen.ip || cfg.beverage_counter.ip
  const hasDevice  = cfg.kitchen.btDevice  || cfg.kitchen.usbDevice ||
                     cfg.beverage_counter.btDevice || cfg.beverage_counter.usbDevice

  if (hasDevice) {
    return new SmartPrinterService({
      kitchen:          { btDevice: cfg.kitchen.btDevice,          usbDevice: cfg.kitchen.usbDevice },
      beverage_counter: { btDevice: cfg.beverage_counter.btDevice, usbDevice: cfg.beverage_counter.usbDevice },
    })
  }

  if (hasNetwork) {
    return new NetworkPrinterService({
      kitchen:          cfg.kitchen.ip,
      beverage_counter: cfg.beverage_counter.ip,
    })
  }

  // Mock - logs to console
  return {
    async printTicket(ticket) {
      const lines = ticket.items.map(i => `  ${i.quantity}x ${i.name}`).join('\n')
      console.log(`[MOCK PRINT → ${ticket.station}] Table ${ticket.tableLabel}\n${lines}`)
    },
  }
}
