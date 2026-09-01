// GET /api/health - liveness + readiness for the container healthcheck and any
// uptime monitor. Deliberately unauthenticated but says nothing sensitive:
// no versions, no hostnames, no configuration values.
//
//   200 { status: 'ok' }        → serving traffic
//   503 { status: 'degraded' }  → database unreachable; do not send traffic

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    const sql = getDb()
    await sql`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      database: 'up',
      latencyMs: Date.now() - startedAt,
    })
  } catch (err) {
    logger.error('health.database_unreachable', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { status: 'degraded', database: 'down', latencyMs: Date.now() - startedAt },
      { status: 503 }
    )
  }
}
