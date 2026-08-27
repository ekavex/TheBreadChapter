import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { format } from 'date-fns'
import { DEMO_CAFE_ID } from '@/lib/constants'

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildReceiptHtml(order: Record<string, unknown>, items: Record<string, unknown>[], table: Record<string, unknown> | null): string {
  const tableLabel = (table?.label as string) ?? (table?.number ? `Table ${table.number}` : 'Takeaway')
  const shortId = (order.id as string).slice(-6).toUpperCase()
  const note = order.customer_note as string | null | undefined

  const itemRows = items.map((item) => {
    const addons = (item.addons_json as { name: string }[] | null) ?? []
    const addonLine = addons.length > 0
      ? `<div class="addon">${addons.map(a => escHtml(a.name)).join(', ')}</div>`
      : ''
    return `
      <div class="item-row">
        <span class="item-qty">${item.quantity}×</span>
        <span class="item-name">${escHtml(item.name as string)}</span>
        <span class="item-price">₹${Math.round((item.subtotal as number) ?? 0)}</span>
      </div>${addonLine}`
  }).join('')

  const noteBlock = note?.trim()
    ? `<div class="div-line"></div><div class="note"><b>Note:</b> ${escHtml(note.trim())}</div>`
    : ''

  const payMethod = order.payment_status === 'paid'
    ? `Paid · ${(order.payment_method as string) ?? 'UPI'}`
    : 'Unpaid'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt · ${order.order_number}</title>
<style>
  @page { size: 80mm auto; margin: 4mm 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #000; background: #fff; width: 74mm; }
  .cafe-name { font-size: 18px; font-weight: 900; letter-spacing: 1px; text-align: center; margin-bottom: 2px; }
  .meta { font-size: 10px; color: #444; text-align: center; margin: 1px 0; }
  .div-line { border-top: 1px dashed #888; margin: 4px 0; }
  .section-label { font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; color: #666; margin: 4px 0 2px; }
  .item-row { display: flex; gap: 4px; margin: 2px 0; font-weight: bold; font-size: 12px; }
  .item-qty { min-width: 20px; flex-shrink: 0; }
  .item-name { flex: 1; word-break: break-word; }
  .item-price { flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .addon { font-size: 10px; font-weight: normal; color: #444; padding-left: 24px; margin-bottom: 2px; }
  .note { font-size: 10px; margin: 3px 0; word-break: break-word; }
  .total-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; margin: 3px 0; font-variant-numeric: tabular-nums; }
  .payment-line { font-size: 10px; text-align: center; margin-top: 4px; color: #444; }
  .footer { font-size: 9px; text-align: center; color: #888; margin-top: 6px; }
</style>
</head>
<body>
  <div class="cafe-name">THE BREAD CHAPTER</div>
  <div class="div-line"></div>
  <div class="meta"><b>${tableLabel}</b></div>
  <div class="meta">Order ${order.order_number} · #${shortId}</div>
  <div class="meta">${format(new Date(order.created_at as string), 'd MMM yyyy, h:mm a')}</div>
  <div class="div-line"></div>
  <div class="section-label">Items</div>
  ${itemRows}
  ${noteBlock}
  <div class="div-line"></div>
  <div class="total-row"><span>TOTAL</span><span>₹${Math.round(order.total_amount as number)}</span></div>
  <div class="div-line"></div>
  <div class="payment-line">${payMethod}</div>
  <div class="footer">Thank you for visiting!</div>
</body>
</html>`
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [order] = await sql`SELECT * FROM orders WHERE id = ${params.id} AND cafe_id = ${DEMO_CAFE_ID}`
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY created_at`
    const [table] = order.table_id
      ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
      : [undefined]

    const html = buildReceiptHtml(
      order as Record<string, unknown>,
      items as Record<string, unknown>[],
      (table ?? null) as Record<string, unknown> | null,
    )
    const filename = `receipt-${order.order_number}.html`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate receipt'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
