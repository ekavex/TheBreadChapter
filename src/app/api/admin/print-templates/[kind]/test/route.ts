import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionUser, requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { getPrintTemplate, queueTestPrint } from '@/lib/printTemplates'
import { validateTemplate } from '@/lib/printer/template/validate'

export const dynamic = 'force-dynamic'

// POST /api/admin/print-templates/bill|kot/test { station, template? }
// Prints a sample ticket on one printer. Pass the editor's unsaved template
// to try a layout before saving it; omit it to test the saved layout.
export async function POST(req: NextRequest, { params }: { params: { kind: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard
  const kind = params.kind === 'bill' || params.kind === 'kot' ? params.kind : null
  if (!kind) return NextResponse.json({ data: null, error: 'kind must be bill or kot' }, { status: 400 })

  try {
    const body = await req.json().catch(() => ({}))
    const station = body?.station
    if (station !== 'kitchen' && station !== 'beverage_counter') {
      return NextResponse.json({ data: null, error: 'station must be kitchen or beverage_counter' }, { status: 400 })
    }

    const sql = getDb()
    let template
    if (body?.template !== undefined) {
      const result = validateTemplate(body.template, kind)
      if (!result.ok) {
        return NextResponse.json({ data: null, error: result.errors.join('; '), errors: result.errors }, { status: 400 })
      }
      template = result.template
    } else {
      template = (await getPrintTemplate(sql, kind)).template
    }

    const user = await getSessionUser(req)
    const id = await queueTestPrint(sql, template, station, user?.displayName || user?.userId || 'unknown')
    return NextResponse.json({ data: { id }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to queue test print' }, { status: 500 })
  }
}
