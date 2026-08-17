// Terminal routing (PINELABS_INTEGRATION_MASTER.md §11).
//
// StoreId scopes the store; ClientId picks the physical A910S the bill appears
// on. With more than one terminal, sending every bill to whichever row came
// back first means the customer at the garden table waits while the bill pops
// up at the counter. Route by the table's section, fall back to the terminal
// with no section (the "house" device), then to any terminal.

import { getDb } from '@/lib/db'
import { DEMO_STORE_ID } from '@/lib/constants'
import { logger } from '@/lib/logger'
import type { Terminal } from '@/lib/types'

export class NoTerminalConfiguredError extends Error {
  constructor() {
    super('No payment terminal is configured — add the A910S ClientId to the terminals table')
    this.name = 'NoTerminalConfiguredError'
  }
}

/**
 * The Pine Labs StoreId for this deployment. Comes from onboarding; the
 * DEMO_STORE_ID placeholder is only acceptable outside production (it is
 * written to payments.store_id and used for settlement matching).
 */
export function resolveStoreId(): string {
  const configured = process.env.PINELABS_STORE_ID?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PINELABS_STORE_ID is not set — refusing to record payments against a placeholder store')
  }
  return DEMO_STORE_ID
}

/**
 * Picks the terminal a given table's bill should be pushed to.
 * sectionId comes from the order's table; null routes to the house terminal.
 */
export async function selectTerminalForSection(sectionId: number | null | undefined): Promise<Terminal> {
  const sql = getDb()

  if (sectionId !== null && sectionId !== undefined) {
    const [sectionTerminal] = await sql`
      SELECT * FROM terminals WHERE section_id = ${sectionId} ORDER BY created_at ASC LIMIT 1
    `
    if (sectionTerminal) return sectionTerminal as unknown as Terminal
  }

  const [houseTerminal] = await sql`
    SELECT * FROM terminals WHERE section_id IS NULL ORDER BY created_at ASC LIMIT 1
  `
  if (houseTerminal) {
    if (sectionId !== null && sectionId !== undefined) {
      logger.warn('payment.terminal.section_fallback', { sectionId, clientId: houseTerminal.client_id })
    }
    return houseTerminal as unknown as Terminal
  }

  const [anyTerminal] = await sql`SELECT * FROM terminals ORDER BY created_at ASC LIMIT 1`
  if (!anyTerminal) throw new NoTerminalConfiguredError()

  logger.warn('payment.terminal.unrouted_fallback', { sectionId, clientId: anyTerminal.client_id })
  return anyTerminal as unknown as Terminal
}

/** Section of the table an order is sitting at (null when the order has no table). */
export async function sectionIdForOrder(orderId: string): Promise<number | null> {
  const sql = getDb()
  const [row] = await sql`
    SELECT t.section_id
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.id = ${orderId}
  `
  const sectionId = (row as unknown as { section_id: number | null } | undefined)?.section_id
  return sectionId ?? null
}
