import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Shared secret auth — no session cookie needed, this is device-to-server.
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

  const sql = getDb()
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
      RETURNING id, order_id, station, items_json
    )
    SELECT
      c.id,
      c.order_id           AS "orderId",
      c.station,
      c.items_json         AS items,
      COALESCE(t.label, t.number::text, 'N/A') AS "tableLabel"
    FROM claimed c
    JOIN orders o ON o.id = c.order_id
    LEFT JOIN tables t ON t.id = o.table_id
  `

  return NextResponse.json({ data: rows, error: null })
}
