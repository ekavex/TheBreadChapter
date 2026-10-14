import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionUser, requireManagerOrAdmin } from '@/lib/auth/requireDashboardSession'
import { logger } from '@/lib/logger'
import { getPrintTemplate, savePrintTemplate, resetPrintTemplate } from '@/lib/printTemplates'
import { validateTemplate } from '@/lib/printer/template/validate'
import type { TemplateKind } from '@/lib/printer/template/types'

export const dynamic = 'force-dynamic'

function parseKind(kind: string): TemplateKind | null {
  return kind === 'bill' || kind === 'kot' ? kind : null
}

// GET /api/admin/print-templates/bill|kot - the saved layout (or the default).
export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard
  const kind = parseKind(params.kind)
  if (!kind) return NextResponse.json({ data: null, error: 'kind must be bill or kot' }, { status: 400 })

  try {
    return NextResponse.json({ data: await getPrintTemplate(getDb(), kind), error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to load layout' }, { status: 500 })
  }
}

// PUT /api/admin/print-templates/bill|kot { template } - save a layout.
// Applies to every ticket printed from the next print-bridge poll onwards.
export async function PUT(req: NextRequest, { params }: { params: { kind: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard
  const kind = parseKind(params.kind)
  if (!kind) return NextResponse.json({ data: null, error: 'kind must be bill or kot' }, { status: 400 })

  try {
    const body = await req.json().catch(() => null)
    const result = validateTemplate(body?.template, kind)
    if (!result.ok) {
      return NextResponse.json({ data: null, error: result.errors.join('; '), errors: result.errors }, { status: 400 })
    }
    const user = await getSessionUser(req)
    const actor = user?.displayName || user?.userId || 'unknown'
    const sql = getDb()
    await savePrintTemplate(sql, result.template, actor)
    logger.info('print_template.saved', { kind, actor, blocks: result.template.blocks.length })
    return NextResponse.json({ data: await getPrintTemplate(sql, kind), error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to save layout' }, { status: 500 })
  }
}

// DELETE /api/admin/print-templates/bill|kot - back to the built-in layout.
export async function DELETE(req: NextRequest, { params }: { params: { kind: string } }) {
  const guard = await requireManagerOrAdmin(req)
  if (guard) return guard
  const kind = parseKind(params.kind)
  if (!kind) return NextResponse.json({ data: null, error: 'kind must be bill or kot' }, { status: 400 })

  try {
    const sql = getDb()
    await resetPrintTemplate(sql, kind)
    const user = await getSessionUser(req)
    logger.info('print_template.reset', { kind, actor: user?.displayName || user?.userId })
    return NextResponse.json({ data: await getPrintTemplate(sql, kind), error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed to reset layout' }, { status: 500 })
  }
}
