import type { PrinterService, KotTicket } from './types'
import { NetworkPrinterService } from './NetworkPrinterService'
import { BluetoothPrinterService } from './BluetoothPrinterService'

class MockPrinterService implements PrinterService {
  async printTicket(ticket: KotTicket): Promise<void> {
    const lines = ticket.items.map((i) => `  ${i.quantity} x ${i.name}`).join('\n')
    console.log(
      `[MOCK PRINT -> ${ticket.station}] Table ${ticket.tableNumber} (order ${ticket.orderId})\n${lines}`
    )
  }
}

// Priority: Bluetooth (BT_DEVICE/BT_MAC) > Network (IP) > Mock (console log).
// Set env vars in .env.local to enable a real printer — no code changes needed.
function createPrinterService(): PrinterService {
  const kitchenBtDevice  = process.env.PRINTER_KITCHEN_BT_DEVICE
  const kitchenBtMac     = process.env.PRINTER_KITCHEN_BT_MAC
  const beverageBtDevice = process.env.PRINTER_BEVERAGE_BT_DEVICE
  const beverageBtMac    = process.env.PRINTER_BEVERAGE_BT_MAC

  if (kitchenBtDevice || kitchenBtMac) {
    const kitchenDevice = kitchenBtDevice ?? '/dev/rfcomm0'

    // If beverage uses the same MAC as kitchen (one physical printer), route it
    // to the same rfcomm device — a single Bluetooth device can only hold one
    // RFCOMM binding at a time.
    const samePrinter = !!beverageBtMac && beverageBtMac === kitchenBtMac
    const beverageDevice = samePrinter
      ? kitchenDevice
      : (beverageBtDevice ?? '/dev/rfcomm1')

    return new BluetoothPrinterService({
      kitchen: {
        device: kitchenDevice,
        mac:    kitchenBtMac,
      },
      beverage_counter: beverageBtDevice || beverageBtMac
        ? { device: beverageDevice, mac: beverageBtMac }
        : undefined,
    })
  }

  const kitchenIp  = process.env.PRINTER_KITCHEN_IP
  const beverageIp = process.env.PRINTER_BEVERAGE_IP
  if (kitchenIp || beverageIp) {
    return new NetworkPrinterService({
      kitchen:          kitchenIp,
      beverage_counter: beverageIp,
    })
  }

  return new MockPrinterService()
}

export const printerService: PrinterService = createPrinterService()
