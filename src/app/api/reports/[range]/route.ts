import { NextRequest, NextResponse } from 'next/server'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { getReportData, getReportDataForWindow, resolveReportRequest } from '@/lib/reports'

export const dynamic = 'force-dynamic'

// GET /api/reports/daily|weekly|monthly - JSON report for the reports page.
// GET /api/reports/custom?from=YYYY-MM-DD&to=YYYY-MM-DD - a chosen date or range
// (omit `to` for a single day).
export async function GET(req: NextRequest, { params }: { params: { range: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  const resolved = resolveReportRequest(params.range, new URL(req.url).searchParams)
  if (!resolved.ok) {
    return NextResponse.json({ data: null, error: resolved.error }, { status: 400 })
  }
  const data = resolved.range === 'custom'
    ? await getReportDataForWindow(resolved.window)
    : await getReportData(resolved.range)
  return NextResponse.json({ data, error: null })
}
