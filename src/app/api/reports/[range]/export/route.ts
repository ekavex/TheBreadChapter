import { NextRequest, NextResponse } from 'next/server'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { getReportData, type ReportRange } from '@/lib/reports'
import { reportToCsv, reportToExcelBuffer, reportToPdfBuffer } from '@/lib/reports-export'

export const dynamic = 'force-dynamic'

// GET /api/reports/daily|weekly|monthly/export?format=csv|excel|pdf
// Module 11 export options.
export async function GET(req: NextRequest, { params }: { params: { range: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  if (!['daily', 'weekly', 'monthly'].includes(params.range)) {
    return NextResponse.json({ data: null, error: 'range must be daily|weekly|monthly' }, { status: 400 })
  }
  const format = new URL(req.url).searchParams.get('format') ?? 'csv'
  if (!['csv', 'excel', 'pdf'].includes(format)) {
    return NextResponse.json({ data: null, error: 'format must be csv|excel|pdf' }, { status: 400 })
  }

  const data = await getReportData(params.range as ReportRange)
  const rangeLabel = params.range

  if (format === 'csv') {
    const csv = reportToCsv(data)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${rangeLabel}.csv"`,
      },
    })
  }

  if (format === 'excel') {
    const buf = reportToExcelBuffer(data)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report-${rangeLabel}.xlsx"`,
      },
    })
  }

  // pdf
  const buf = reportToPdfBuffer(data)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${rangeLabel}.pdf"`,
    },
  })
}
