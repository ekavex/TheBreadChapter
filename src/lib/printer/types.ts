// ─── PrinterService abstraction (Module 5 — KOT routing) ─────
// Kitchen and beverage counter are separate physical thermal printers.
// Business logic never talks to a printer driver directly.

export type KotStation = 'kitchen' | 'beverage_counter'

export interface KotTicketItem {
  name: string
  quantity: number
}

export interface KotTicket {
  tableNumber: number
  orderId: string
  station: KotStation
  items: KotTicketItem[]
}

export interface PrinterService {
  printTicket(ticket: KotTicket): Promise<void>
}
