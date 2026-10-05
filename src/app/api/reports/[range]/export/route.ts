import { NextRequest, NextResponse } from 'next/server'
import { requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { format } from 'date-fns'
import { getReportData, getReportDataForWindow, resolveReportRequest } from '@/lib/reports'
import { reportToCsv, reportToExcelBuffer, reportToPdfBuffer } from '@/lib/reports-export'

export const dynamic = 'force-dynamic'

// GET /api/reports/daily|weekly|monthly/export?format=csv|excel|pdf
// GET /api/reports/custom/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=...
// Module 11 export options.
export async function GET(req: NextRequest, { params }: { params: { range: string } }) {
  const sessionGuard = await requireManagerOrAdmin(req)
  if (sessionGuard) return sessionGuard

  const searchParams = new URL(req.url).searchParams
  const resolved = resolveReportRequest(params.range, searchParams)
  if (!resolved.ok) {
    return NextResponse.json({ data: null, error: resolved.error }, { status: 400 })
  }
  const exportFormat = searchParams.get('format') ?? 'csv'
  if (!['csv', 'excel', 'pdf'].includes(exportFormat)) {
    return NextResponse.json({ data: null, error: 'format must be csv|excel|pdf' }, { status: 400 })
  }

  const data = resolved.range === 'custom'
    ? await getReportDataForWindow(resolved.window)
    : await getReportData(resolved.range)

  // e.g. report-monthly, report-2026-10-05, report-2026-10-01_to_2026-10-05
  let rangeLabel: string = params.range
  if (resolved.range === 'custom') {
    const fromStr = format(resolved.window.from, 'yyyy-MM-dd')
    const toStr = format(resolved.window.to, 'yyyy-MM-dd')
    rangeLabel = fromStr === toStr ? fromStr : `${fromStr}_to_${toStr}`
  }

  if (exportFormat === 'csv') {
    const csv = reportToCsv(data)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${rangeLabel}.csv"`,
      },
    })
  }

  if (exportFormat === 'excel') {
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
