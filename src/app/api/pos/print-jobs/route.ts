import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { recordPrintEvent } from '@/lib/printLog'

// How long a job can sit at 'processing' (claimed by the bridge, never
// confirmed) before it's treated as stuck and put back to 'queued' for
// another poll to pick up. Tunable per-deployment via env instead of a
// hardcoded guess - see docs discussion on print reliability.
const STALE_PROCESSING_SECONDS = Number(process.env.PRINT_JOB_STALE_SECONDS ?? 45)

export const dynamic = 'force-dynamic'

// UPI merchant details for the QR bill.
const UPI_BASE =
  'upi://pay?pa=anv.ltd986@kotak&pn=ANV%20HOSPITALITY%20PVT%20LTD&mc=0000&mode=02&purpose=00'

function buildUpiUrl(amountPaisa: number): string {
  const rupees = (amountPaisa / 100).toFixed(2)
  return `${UPI_BASE}&am=${rupees}&cu=INR&orgId=400043`
}

// Shared secret auth - no session cookie needed, this is device-to-server.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.PRINT_BRIDGE_TOKEN?.trim()
  if (!expected) return process.env.NODE_ENV !== 'production'
  const provided =
    req.headers.get('x-print-bridge-token')?.trim() ??
    new URL(req.url).searchParams.get('token')?.trim() ??
    ''
  return provided === expected
}

// GET /api/pos/print-jobs?station=kitchen&token=XYZ
// Returns pending (queued) KOT tickets for the Android print bridge.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const station = new URL(req.url).searchParams.get('station')
  if (!station) {
    return NextResponse.json({ data: null, error: 'station param required' }, { status: 400 })
  }

  try {
    const sql = getDb()

    // Safety net: a job the bridge claimed ('processing') but never confirmed
    // via PATCH - bridge phone rebooted, lost Bluetooth, app got killed mid-print -
    // would otherwise sit stuck forever, since claiming is a one-way door. Anything
    // still 'processing' well past a normal print cycle goes back to 'queued' so
    // the next poll (from this device or another) picks it up again.
    //
    // If the bridge actually did print before going silent, this reclaim causes
    // a genuine second physical print on the next claim - unavoidable without the
    // bridge confirming reliably, but every reclaim is logged so it shows up on
    // the admin Printing page instead of being invisible.
    const reclaimed = await sql`
      UPDATE kot_tickets
      SET print_status = 'queued'
      WHERE print_status = 'processing'
        AND printed_at < now() - (${STALE_PROCESSING_SECONDS} * interval '1 second')
      RETURNING id, order_id, station, job_type
    `
    for (const row of reclaimed as unknown as { id: string; order_id: string; station: string; job_type: string }[]) {
      logger.warn('print_bridge.stale_reclaim', { jobId: row.id, orderId: row.order_id, station: row.station })
      await recordPrintEvent(sql, {
        orderId: row.order_id, station: row.station, jobType: row.job_type, event: 'stale_reclaimed',
        kotTicketId: row.id, detail: `no print-bridge confirmation within ${STALE_PROCESSING_SECONDS}s`,
      })
    }

    // Atomically claim queued jobs by marking them 'processing' so a second poll
    // within the same 3-second window cannot pick up the same ticket again.
    const rows = await sql`
      WITH claimed AS (
        UPDATE kot_tickets
        SET print_status = 'processing'
        WHERE id IN (
          SELECT id FROM kot_tickets
          WHERE (${station} = 'all' OR station = ${station})
            AND print_status = 'queued'
          ORDER BY printed_at ASC
          LIMIT 10
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, order_id, station, items_json, job_type, taken_by
      )
      SELECT
        c.id,
        c.order_id           AS "orderId",
        c.station,
        c.items_json         AS items,
        c.job_type           AS "jobType",
        c.taken_by           AS "takenBy",
        o.total_paisa        AS "amountPaisa",
        o.customer_note      AS "customerNote",
        COALESCE(t.label, t.number::text, 'N/A') AS "tableLabel"
      FROM claimed c
      JOIN orders o ON o.id = c.order_id
      LEFT JOIN tables t ON t.id = o.table_id
    `

    // For bill_qr jobs, attach the pre-built UPI URL with the order total.
    const data = (rows as Record<string, unknown>[]).map((row) => {
      if (row['jobType'] === 'bill_qr') {
        return { ...row, upiUrl: buildUpiUrl(Number(row['amountPaisa'])) }
      }
      return row
    })

    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('print_jobs.poll_error', { error: message, station })
    return NextResponse.json(
      { data: null, error: message },
      { status: 500 }
    )
  }
}
