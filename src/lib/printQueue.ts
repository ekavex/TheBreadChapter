// Shared queuing logic for the bill_qr print job (used by both the checkout
// QR-bill flow and the dashboard's historical reprint). Both insert against
// the same uniq_active_kot_ticket constraint (migration 010) so a
// double-click / repeated request can't queue two physical bill prints.

import type postgres from 'postgres'
import { logger } from '@/lib/logger'
import { recordPrintEvent, isMissingConflictTarget } from '@/lib/printLog'

type SqlClient = postgres.Sql<any>

export interface BillQrItem {
  name: string
  quantity: number
  subtotal: number
  addons: string[]
}

export interface QueueBillQrResult {
  ok: boolean
  duplicate: boolean
}

export async function queueBillQrTicket(
  sql: SqlClient,
  orderId: string,
  itemsJson: BillQrItem[],
  actor?: string | null,
): Promise<QueueBillQrResult> {
  const station = 'beverage_counter'

  let insertedId: string | null = null
  try {
    const rows = await sql`
      INSERT INTO kot_tickets (order_id, station, items_json, print_status, job_type)
      VALUES (${orderId}, ${station}, ${sql.json(itemsJson as never)}, 'queued', 'bill_qr')
      ON CONFLICT (order_id, station, job_type) WHERE print_status IN ('queued', 'processing')
      DO NOTHING
      RETURNING id
    `
    insertedId = (rows[0] as { id: string } | undefined)?.id ?? null
  } catch (err) {
    if (!isMissingConflictTarget(err)) throw err
    logger.error('bill_qr.print.conflict_index_missing', { orderId })
    const rows = await sql`
      INSERT INTO kot_tickets (order_id, station, items_json, print_status, job_type)
      VALUES (${orderId}, ${station}, ${sql.json(itemsJson as never)}, 'queued', 'bill_qr')
      RETURNING id
    `
    insertedId = (rows[0] as { id: string } | undefined)?.id ?? null
  }

  if (!insertedId) {
    logger.warn('bill_qr.print.skipped_duplicate', { orderId, reason: 'concurrent_active_ticket' })
    await recordPrintEvent(sql, {
      orderId, station, jobType: 'bill_qr', event: 'skipped_duplicate',
      detail: 'concurrent active ticket', actor,
    })
    return { ok: true, duplicate: true }
  }

  await recordPrintEvent(sql, {
    orderId, station, jobType: 'bill_qr', event: 'queued',
    kotTicketId: insertedId, actor,
  })
  return { ok: true, duplicate: false }
}
