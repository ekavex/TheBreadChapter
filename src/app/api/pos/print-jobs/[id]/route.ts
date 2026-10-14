import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { recordPrintEvent } from '@/lib/printLog'

export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.PRINT_BRIDGE_TOKEN?.trim()
  if (!expected) return process.env.NODE_ENV !== 'production'
  const provided =
    req.headers.get('x-print-bridge-token')?.trim() ??
    new URL(req.url).searchParams.get('token')?.trim() ??
    ''
  return provided === expected
}

// PATCH /api/pos/print-jobs/[id]?token=XYZ
// Android APK calls this after printing a ticket. Body (optional, APK 1.1.1+):
// { outcome: 'partial', detail } when the Bluetooth connection dropped part-way
// through a bill - it's confirmed anyway (resending could print a second bill)
// and the detail is shown on the admin Printing page so staff can reprint.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { outcome?: unknown; detail?: unknown } | null
  const partialDetail = body?.outcome === 'partial'
    ? String(body.detail ?? 'connection dropped part-way through printing').slice(0, 300)
    : null

  const sql = getDb()
  const [row] = await sql`
    UPDATE kot_tickets
    SET print_status = 'printed', printed_at = now()
    WHERE id = ${params.id} AND print_status IN ('queued', 'processing')
    RETURNING id, order_id, station, job_type
  `

  if (!row) {
    // Not an order ticket - maybe a test print from the layout editor.
    const [test] = await sql`
      UPDATE print_test_jobs
      SET status = 'printed', printed_at = now()
      WHERE id = ${params.id} AND status IN ('queued', 'processing')
      RETURNING id
    `
    if (test) {
      logger.info('print_bridge.test_done', { jobId: params.id })
      return NextResponse.json({ data: { ok: true }, error: null })
    }
    return NextResponse.json({ data: null, error: 'Job not found or already done' }, { status: 404 })
  }

  if (partialDetail) {
    logger.warn('print_bridge.job_partial', { jobId: params.id, orderId: row.order_id, message: partialDetail })
  } else {
    logger.info('print_bridge.job_done', { jobId: params.id })
  }
  await recordPrintEvent(sql, {
    orderId: row.order_id, station: row.station, jobType: row.job_type, event: 'printed',
    kotTicketId: row.id, detail: partialDetail ?? undefined,
  })
  return NextResponse.json({ data: { ok: true }, error: null })
}
