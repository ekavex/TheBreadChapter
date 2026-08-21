import type { PrinterService, KotTicket } from './types'
import { NetworkPrinterService } from './NetworkPrinterService'
import { BluetoothPrinterService } from './BluetoothPrinterService'
import { UsbPrinterService } from './UsbPrinterService'

class MockPrinterService implements PrinterService {
  async printTicket(ticket: KotTicket): Promise<void> {
    const lines = ticket.items.map((i) => `  ${i.quantity} x ${i.name}`).join('\n')
    console.log(
      `[MOCK PRINT -> ${ticket.station}] Table ${ticket.tableLabel} (order ${ticket.orderId})\n${lines}`
    )
  }
}

// Priority: USB > Bluetooth/RFCOMM > Network (TCP) > Mock (console log).
// Set the matching env vars in .env.local — no code changes needed.
//
//  USB:       PRINTER_KITCHEN_USB_DEVICE=/dev/usb/lp0
//             PRINTER_BEVERAGE_USB_DEVICE=/dev/usb/lp1
//
//  Bluetooth: PRINTER_KITCHEN_BT_MAC=AA:BB:CC:DD:EE:FF
//             PRINTER_KITCHEN_BT_DEVICE=/dev/rfcomm0   (optional, defaults to /dev/rfcomm0)
//             PRINTER_BEVERAGE_BT_MAC=AA:BB:CC:DD:EE:FF
//             PRINTER_BEVERAGE_BT_DEVICE=/dev/rfcomm1  (optional, defaults to /dev/rfcomm1)
//
//  Network:   PRINTER_KITCHEN_IP=192.168.1.100
//             PRINTER_BEVERAGE_IP=192.168.1.101
function createPrinterService(): PrinterService {
  // ── USB ──────────────────────────────────────────────────────────────────────
  const kitchenUsb  = process.env.PRINTER_KITCHEN_USB_DEVICE
  const beverageUsb = process.env.PRINTER_BEVERAGE_USB_DEVICE
  if (kitchenUsb || beverageUsb) {
    return new UsbPrinterService({
      kitchen:          kitchenUsb,
      beverage_counter: beverageUsb,
    })
  }

  // ── Bluetooth / RFCOMM ────────────────────────────────────────────────────────
  const kitchenBtMac     = process.env.PRINTER_KITCHEN_BT_MAC
  const kitchenBtDevice  = process.env.PRINTER_KITCHEN_BT_DEVICE
  const beverageBtMac    = process.env.PRINTER_BEVERAGE_BT_MAC
  const beverageBtDevice = process.env.PRINTER_BEVERAGE_BT_DEVICE

  if (kitchenBtMac || kitchenBtDevice) {
    // If both stations share the same MAC it's one physical printer — route
    // both stations to the same RFCOMM device (can't hold two bindings at once).
    const samePrinter = !!beverageBtMac && beverageBtMac === kitchenBtMac
    return new BluetoothPrinterService({
      kitchen: {
        device: kitchenBtDevice ?? '/dev/rfcomm0',
        mac:    kitchenBtMac,
      },
      beverage_counter: (beverageBtMac || beverageBtDevice)
        ? {
            device: samePrinter ? (kitchenBtDevice ?? '/dev/rfcomm0') : (beverageBtDevice ?? '/dev/rfcomm1'),
            mac:    beverageBtMac,
          }
        : undefined,
    })
  }

  // ── Network (raw TCP port 9100) ───────────────────────────────────────────────
  const kitchenIp  = process.env.PRINTER_KITCHEN_IP
  const beverageIp = process.env.PRINTER_BEVERAGE_IP
  if (kitchenIp || beverageIp) {
    return new NetworkPrinterService({
      kitchen:          kitchenIp,
      beverage_counter: beverageIp,
    })
  }

  // ── Mock (console log fallback) ───────────────────────────────────────────────
  return new MockPrinterService()
}

export const printerService: PrinterService = createPrinterService()
