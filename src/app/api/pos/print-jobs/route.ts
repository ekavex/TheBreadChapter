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
  const rows = await sql`
    SELECT
      kt.id,
      kt.order_id          AS "orderId",
      kt.station,
      kt.items_json        AS items,
      COALESCE(t.label, t.number::text, 'N/A') AS "tableLabel"
    FROM kot_tickets kt
    JOIN orders o ON o.id = kt.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE (${station} = 'all' OR kt.station = ${station})
      AND kt.print_status = 'queued'
    ORDER BY kt.printed_at ASC
    LIMIT 10
  `

  return NextResponse.json({ data: rows, error: null })
}
