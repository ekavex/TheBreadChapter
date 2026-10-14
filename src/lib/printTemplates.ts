// Server side of customisable print layouts: loading/saving templates, and
// rendering a claimed print job into the ESC/POS bytes the Android print
// bridge sends straight to the printer.
import type postgres from 'postgres'
import { DEMO_CAFE_ID } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { getBillPrintDetails } from '@/lib/billDetails'
import { renderTicket, bytesToBase64 } from '@/lib/printer/template/render'
import { defaultTemplate } from '@/lib/printer/template/defaults'
import { DEFAULT_LOGO } from '@/lib/printer/template/defaultLogo'
import { validateTemplate } from '@/lib/printer/template/validate'
import { sampleTicketData } from '@/lib/printer/template/sample'
import type { PrintTemplate, TemplateKind, TicketData, TicketItem } from '@/lib/printer/template/types'

type SqlClient = postgres.Sql<any>

export interface StoredTemplate {
  template: PrintTemplate
  isDefault: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export async function getPrintTemplate(sql: SqlClient, kind: TemplateKind): Promise<StoredTemplate> {
  const [row] = await sql`
    SELECT template, updated_at, updated_by FROM print_templates
    WHERE cafe_id = ${DEMO_CAFE_ID} AND kind = ${kind}
  `
  if (!row) return { template: defaultTemplate(kind), isDefault: true, updatedAt: null, updatedBy: null }

  const result = validateTemplate(row.template, kind)
  if (!result.ok) {
    // Never let a bad stored layout stop printing - fall back to the default.
    logger.error('print_template.invalid_stored', { kind, errors: result.errors })
    return { template: defaultTemplate(kind), isDefault: true, updatedAt: null, updatedBy: null }
  }
  return {
    template: result.template,
    isDefault: false,
    updatedAt: (row.updated_at as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
  }
}

export async function savePrintTemplate(sql: SqlClient, template: PrintTemplate, actor: string): Promise<void> {
  await sql`
    INSERT INTO print_templates (cafe_id, kind, template, updated_at, updated_by)
    VALUES (${DEMO_CAFE_ID}, ${template.kind}, ${sql.json(template as never)}, now(), ${actor})
    ON CONFLICT (cafe_id, kind)
    DO UPDATE SET template = EXCLUDED.template, updated_at = now(), updated_by = EXCLUDED.updated_by
  `
}

export async function resetPrintTemplate(sql: SqlClient, kind: TemplateKind): Promise<void> {
  await sql`DELETE FROM print_templates WHERE cafe_id = ${DEMO_CAFE_ID} AND kind = ${kind}`
}

export function renderToBase64(template: PrintTemplate, data: TicketData): string {
  return bytesToBase64(renderTicket(template, data, DEFAULT_LOGO).bytes)
}

// A row from the print-jobs claim query.
export interface ClaimedJobRow {
  id: string
  orderId: string
  station: string
  items: unknown
  jobType: string
  takenBy: string | null
  orderNumber: string | null
  amountPaisa: number | string | null
  subtotal: number | string | null
  taxAmount: number | string | null
  serviceCharge: number | string | null
  customerNote: string | null
  tableLabel: string
  upiUrl?: string
}

function parseItems(raw: unknown): TicketItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((i: Record<string, unknown>) => ({
    name: String(i.name ?? ''),
    quantity: Number(i.quantity ?? 1),
    subtotal: i.subtotal == null ? undefined : Number(i.subtotal),
    addons: Array.isArray(i.addons) ? i.addons.map(String).filter(Boolean) : [],
  }))
}

const rupeesToPaisa = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

// Renders one claimed job with the current saved layout. Returns null if
// rendering fails, in which case the bridge falls back to its own built-in
// layout - a layout problem must never stop a KOT or bill from printing.
export async function renderJobPayload(
  sql: SqlClient,
  row: ClaimedJobRow,
  templates: Map<TemplateKind, PrintTemplate>,
): Promise<string | null> {
  try {
    const kind: TemplateKind = row.jobType === 'bill_qr' ? 'bill' : 'kot'
    let template = templates.get(kind)
    if (!template) {
      template = (await getPrintTemplate(sql, kind)).template
      templates.set(kind, template)
    }

    const base: TicketData = {
      tableLabel: row.tableLabel,
      station: row.station,
      orderNumber: row.orderNumber,
      orderId: row.orderId,
      billNumber: null,
      staffName: row.takenBy,
      fssaiNumber: null,
      printedAt: new Date(),
      items: parseItems(row.items),
      note: row.customerNote,
      subtotalPaisa: rupeesToPaisa(row.subtotal),
      taxPaisa: rupeesToPaisa(row.taxAmount),
      serviceChargePaisa: rupeesToPaisa(row.serviceCharge),
      totalPaisa: Number(row.amountPaisa ?? 0),
      upiUrl: row.upiUrl ?? null,
      paid: false,
      paymentMode: null,
      paymentRef: null,
    }

    if (kind === 'bill') {
      const details = await getBillPrintDetails(sql, row.orderId)
      if (details) {
        Object.assign(base, {
          billNumber: details.billNumber,
          orderNumber: details.orderNumber ?? base.orderNumber,
          staffName: details.staffName,
          fssaiNumber: details.fssaiNumber,
          paid: details.paid,
          paymentMode: details.paymentMode,
          paymentRef: details.paymentRef,
        })
      }
    }

    return renderToBase64(template, base)
  } catch (err) {
    logger.error('print_template.render_failed', {
      jobId: row.id, orderId: row.orderId, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Queues a sample ticket rendered with `template` (saved or not) to one
// printer. The bridge picks it up on its next poll like any other job.
export async function queueTestPrint(
  sql: SqlClient,
  template: PrintTemplate,
  station: 'kitchen' | 'beverage_counter',
  actor: string,
): Promise<string> {
  const [{ fssai }] = await sql`
    SELECT NULLIF(btrim(settings->>'fssai_number'), '') AS fssai FROM cafes WHERE id = ${DEMO_CAFE_ID}
  `
  const data = sampleTicketData(template.kind, { fssaiNumber: (fssai as string | null) ?? null })
  data.station = station
  const payload = Buffer.from(renderTicket(template, data, DEFAULT_LOGO).bytes)
  const [row] = await sql`
    INSERT INTO print_test_jobs (cafe_id, station, kind, payload, requested_by)
    VALUES (${DEMO_CAFE_ID}, ${station}, ${template.kind}, ${payload}, ${actor})
    RETURNING id
  `
  logger.info('print_test.queued', { id: row.id, station, kind: template.kind, actor })
  return row.id as string
}
