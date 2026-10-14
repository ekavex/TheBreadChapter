// Sample order used for the editor's live preview and for "Print test".
import type { TemplateKind, TicketData } from './types'

export function sampleTicketData(kind: TemplateKind, opts: { paid?: boolean; fssaiNumber?: string | null } = {}): TicketData {
  const paid = opts.paid ?? false
  const items = kind === 'bill'
    ? [
        { name: 'Cold Brew', quantity: 2, subtotal: 360, addons: ['Oat milk'] },
        { name: 'Chocolate Croissant', quantity: 1, subtotal: 180, addons: [] },
        { name: 'Avocado Toast with Poached Egg and Microgreens', quantity: 1, subtotal: 320, addons: [] },
      ]
    : [
        { name: 'Cold Brew', quantity: 2, addons: ['Oat milk', 'Less ice'] },
        { name: 'Chocolate Croissant', quantity: 1, addons: [] },
      ]
  const subtotalPaisa = 86000
  const taxPaisa = 4300
  return {
    tableLabel: 'Indoor 4',
    station: kind === 'kot' ? 'beverage_counter' : null,
    orderNumber: 'ORD-0042',
    orderId: '00000000-0000-0000-0000-00000000a1b2',
    billNumber: kind === 'bill' ? 'TBC/26-27/0001' : null,
    staffName: 'Ravi',
    fssaiNumber: opts.fssaiNumber ?? null,
    printedAt: new Date(),
    items,
    note: 'Less sugar in one cold brew',
    subtotalPaisa,
    taxPaisa,
    serviceChargePaisa: 0,
    totalPaisa: subtotalPaisa + taxPaisa,
    upiUrl: kind === 'bill' ? 'upi://pay?pa=example@upi&pn=The%20Bread%20Chapter&am=903.00&cu=INR' : null,
    paid,
    paymentMode: paid ? 'UPI' : null,
    paymentRef: paid ? '429817365012' : null,
  }
}
