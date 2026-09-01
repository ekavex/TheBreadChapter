// ─── PrinterService abstraction (Module 5 - KOT routing) ─────
// Kitchen and beverage counter are separate physical thermal printers.
// Business logic never talks to a printer driver directly.

export type KotStation = 'kitchen' | 'beverage_counter'

export interface KotTicketItem {
  name: string
  quantity: number
  addons?: string[]  // display names of selected add-ons
}

export interface KotTicket {
  tableLabel: string
  orderId: string
  station: KotStation
  items: KotTicketItem[]
  customerNote?: string | null
  takenBy?: string | null
}

export interface PrinterService {
  printTicket(ticket: KotTicket): Promise<void>
}
