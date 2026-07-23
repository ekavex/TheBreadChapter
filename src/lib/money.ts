// Money is stored as integer paisa across the new Smart Cafe tables
// (ingredients, recipes cost cache, orders.total_paisa, payments — see
// docs/DEVELOPER_HANDOVER_MASTER.md §3). Convert once at the UI boundary.

export function rupeesToPaisa(rupees: number): number {
  return Math.round(rupees * 100)
}

export function paisaToRupees(paisa: number): number {
  return paisa / 100
}

export function formatPaisa(paisa: number): string {
  return `₹${paisaToRupees(paisa).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
