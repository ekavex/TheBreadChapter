import { NextRequest, NextResponse } from 'next/server'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { getReportData, type ReportRange } from '@/lib/reports'

export const dynamic = 'force-dynamic'

// GET /api/reports/daily|weekly|monthly — JSON report for the reports page.
export async function GET(req: NextRequest, { params }: { params: { range: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  if (!['daily', 'weekly', 'monthly'].includes(params.range)) {
    return NextResponse.json({ data: null, error: 'range must be daily|weekly|monthly' }, { status: 400 })
  }
  const data = await getReportData(params.range as ReportRange)
  return NextResponse.json({ data, error: null })
}
