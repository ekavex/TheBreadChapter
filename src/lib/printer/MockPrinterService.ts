import type { PrinterService, KotTicket } from './types'

// Logs the ticket instead of talking to real network/BT hardware.
// Swap for a real network/Bluetooth thermal-printer client once printer
// models/connectivity are confirmed with the client — same interface.
export class MockPrinterService implements PrinterService {
  async printTicket(ticket: KotTicket): Promise<void> {
    const lines = ticket.items.map((i) => `  ${i.quantity} x ${i.name}`).join('\n')
    console.log(
      `[MOCK PRINT -> ${ticket.station}] Table ${ticket.tableNumber} (order ${ticket.orderId})\n${lines}`
    )
  }
}

export const printerService: PrinterService = new MockPrinterService()
