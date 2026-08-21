import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

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
// Android APK calls this after successfully printing a ticket.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const sql = getDb()
  const [row] = await sql`
    UPDATE kot_tickets
    SET print_status = 'printed', printed_at = now()
    WHERE id = ${params.id} AND print_status IN ('queued', 'processing')
    RETURNING id
  `

  if (!row) {
    return NextResponse.json({ data: null, error: 'Job not found or already done' }, { status: 404 })
  }

  logger.info('print_bridge.job_done', { jobId: params.id })
  return NextResponse.json({ data: { ok: true }, error: null })
}
