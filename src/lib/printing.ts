// Read-side queries for the admin "Printing" page - answers the operational
// questions ops actually asks: how many times did this print, when, and
// what never confirmed as printed. Sourced from print_log (the audit trail,
// migration 010) and kot_tickets (live queue state).
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'

// A job claimed or queued this long ago with no 'printed' confirmation is
// almost certainly stuck (well past the print-bridge's stale-reclaim window
// and its own ~3s poll interval) - not just normally in flight.
const STUCK_AFTER_MINUTES = 3
const LOG_WINDOW_DAYS = 7

export interface PrintOverview {
  printedToday: number
  printedLast7Days: number
  duplicatesPreventedLast7Days: number
  staleReclaimsLast7Days: number
  stuckNow: number
}

export interface StuckPrintJob {
  id: string
  orderId: string
  orderNumber: string | null
  tableLabel: string | null
  station: string
  jobType: string
  printStatus: string
  queuedSince: string
  ageSeconds: number
}

export interface PrintLogRow {
  id: string
  orderId: string
  orderNumber: string | null
  tableLabel: string | null
  station: string
  jobType: string
  event: string
  detail: string | null
  actor: string | null
  createdAt: string
}

export interface OrderPrintSummary {
  orderId: string
  orderNumber: string | null
  tableLabel: string | null
  jobType: string
  printedCount: number
  duplicatesPreventedCount: number
  staleReclaimedCount: number
  lastEventAt: string
  currentlyStuck: boolean
}

const TABLE_LABEL_SQL = `COALESCE(t.label, t.number::text, 'Takeaway')`

export async function getPrintOverview(): Promise<PrintOverview> {
  const sql = getDb()

  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE pl.event = 'printed' AND pl.created_at >= date_trunc('day', now())) AS printed_today,
      COUNT(*) FILTER (WHERE pl.event = 'printed' AND pl.created_at >= now() - (${LOG_WINDOW_DAYS} * interval '1 day')) AS printed_7d,
      COUNT(*) FILTER (WHERE pl.event = 'skipped_duplicate' AND pl.created_at >= now() - (${LOG_WINDOW_DAYS} * interval '1 day')) AS dupes_prevented_7d,
      COUNT(*) FILTER (WHERE pl.event = 'stale_reclaimed' AND pl.created_at >= now() - (${LOG_WINDOW_DAYS} * interval '1 day')) AS stale_reclaims_7d
    FROM print_log pl
    JOIN orders o ON o.id = pl.order_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
  `

  const [stuckRow] = await sql`
    SELECT COUNT(*) AS stuck_now
    FROM kot_tickets kt
    JOIN orders o ON o.id = kt.order_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND kt.print_status IN ('queued', 'processing')
      AND kt.printed_at < now() - (${STUCK_AFTER_MINUTES} * interval '1 minute')
  `

  return {
    printedToday: Number(row?.printed_today ?? 0),
    printedLast7Days: Number(row?.printed_7d ?? 0),
    duplicatesPreventedLast7Days: Number(row?.dupes_prevented_7d ?? 0),
    staleReclaimsLast7Days: Number(row?.stale_reclaims_7d ?? 0),
    stuckNow: Number(stuckRow?.stuck_now ?? 0),
  }
}

export async function getStuckPrintJobs(): Promise<StuckPrintJob[]> {
  const sql = getDb()
  const rows = await sql`
    SELECT
      kt.id, kt.order_id, kt.station, kt.job_type, kt.print_status, kt.printed_at,
      o.order_number,
      ${sql.unsafe(TABLE_LABEL_SQL)} AS table_label,
      EXTRACT(EPOCH FROM (now() - kt.printed_at)) AS age_seconds
    FROM kot_tickets kt
    JOIN orders o ON o.id = kt.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND kt.print_status IN ('queued', 'processing')
      AND kt.printed_at < now() - (${STUCK_AFTER_MINUTES} * interval '1 minute')
    ORDER BY kt.printed_at ASC
    LIMIT 100
  `

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: (r.order_number as string | null) ?? null,
    tableLabel: (r.table_label as string | null) ?? null,
    station: String(r.station),
    jobType: String(r.job_type),
    printStatus: String(r.print_status),
    queuedSince: String(r.printed_at),
    ageSeconds: Math.round(Number(r.age_seconds)),
  }))
}

export async function getPrintLogFeed(limit = 100): Promise<PrintLogRow[]> {
  const sql = getDb()
  const rows = await sql`
    SELECT
      pl.id, pl.order_id, pl.station, pl.job_type, pl.event, pl.detail, pl.actor, pl.created_at,
      o.order_number,
      ${sql.unsafe(TABLE_LABEL_SQL)} AS table_label
    FROM print_log pl
    JOIN orders o ON o.id = pl.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
    ORDER BY pl.created_at DESC
    LIMIT ${limit}
  `

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: (r.order_number as string | null) ?? null,
    tableLabel: (r.table_label as string | null) ?? null,
    station: String(r.station),
    jobType: String(r.job_type),
    event: String(r.event),
    detail: (r.detail as string | null) ?? null,
    actor: (r.actor as string | null) ?? null,
    createdAt: String(r.created_at),
  }))
}

// Per order+station+job_type: how many times it actually printed, how many
// duplicate attempts were caught, and whether it's currently stuck. This is
// the direct answer to "how many times did this receipt/bill print."
export async function getOrderPrintSummaries(days = LOG_WINDOW_DAYS): Promise<OrderPrintSummary[]> {
  const sql = getDb()
  const rows = await sql`
    SELECT
      pl.order_id, o.order_number,
      ${sql.unsafe(TABLE_LABEL_SQL)} AS table_label,
      pl.job_type,
      COUNT(*) FILTER (WHERE pl.event = 'printed') AS printed_count,
      COUNT(*) FILTER (WHERE pl.event = 'skipped_duplicate') AS dupes_prevented_count,
      COUNT(*) FILTER (WHERE pl.event = 'stale_reclaimed') AS stale_reclaimed_count,
      MAX(pl.created_at) AS last_event_at,
      BOOL_OR(kt.print_status IN ('queued', 'processing') AND kt.printed_at < now() - (${STUCK_AFTER_MINUTES} * interval '1 minute')) AS currently_stuck
    FROM print_log pl
    JOIN orders o ON o.id = pl.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN kot_tickets kt ON kt.id = pl.kot_ticket_id
    WHERE o.cafe_id = ${DEMO_CAFE_ID}
      AND pl.created_at >= now() - (${days} * interval '1 day')
    GROUP BY pl.order_id, o.order_number, table_label, pl.job_type
    HAVING COUNT(*) FILTER (WHERE pl.event = 'printed') > 1
        OR COUNT(*) FILTER (WHERE pl.event = 'skipped_duplicate') > 0
        OR COUNT(*) FILTER (WHERE pl.event = 'stale_reclaimed') > 0
    ORDER BY MAX(pl.created_at) DESC
    LIMIT 100
  `

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    orderId: String(r.order_id),
    orderNumber: (r.order_number as string | null) ?? null,
    tableLabel: (r.table_label as string | null) ?? null,
    jobType: String(r.job_type),
    printedCount: Number(r.printed_count),
    duplicatesPreventedCount: Number(r.dupes_prevented_count),
    staleReclaimedCount: Number(r.stale_reclaimed_count),
    lastEventAt: String(r.last_event_at),
    currentlyStuck: Boolean(r.currently_stuck),
  }))
}
