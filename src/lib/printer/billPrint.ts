// Browser-side customer bill (58 mm thermal, 32 columns).
//
// The KOT goes to the kitchen; this is the slip the customer is handed. Uses
// the same popup-then-print approach as kotPrint so it works with any printer
// the tablet can already see, with an iframe fallback when popups are blocked.

interface BillOrder {
  id: string
  order_number?: string | null
  subtotal?: number | null
  tax_amount?: number | null
  service_charge?: number | null
  discount_amount?: number | null
  total_amount?: number | null
  created_at?: string | null
  items?: { name: string; quantity: number; price: number; subtotal: number; customisation?: string | null }[] | null
  table?: { number?: number | null } | null
}

interface BillOptions {
  paid: boolean
  mode?: string | null
  cafeName?: string
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function money(value: number | null | undefined): string {
  return `₹${Number(value ?? 0).toFixed(2)}`
}

export function printBill(order: BillOrder, opts: BillOptions): void {
  const items = order.items ?? []
  if (items.length === 0) return

  const cafeName = opts.cafeName ?? process.env.NEXT_PUBLIC_APP_NAME ?? 'The Bread Chapter'
  const when = new Date(order.created_at ?? Date.now()).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const rows = items
    .map((i) => {
      const name = escHtml(i.name) + (i.customisation ? ` <span class="note">(${escHtml(i.customisation)})</span>` : '')
      return `<tr><td class="qty">${i.quantity}×</td><td class="name">${name}</td><td class="amt">${money(i.subtotal)}</td></tr>`
    })
    .join('')

  const totalsRow = (label: string, value: number | null | undefined, bold = false) =>
    Number(value ?? 0) === 0 && !bold
      ? ''
      : `<tr class="${bold ? 'grand' : ''}"><td colspan="2">${label}</td><td class="amt">${money(value)}</td></tr>`

  const body = `
    <div class="head">
      <div class="cafe">${escHtml(cafeName)}</div>
      <div class="meta">Bill ${escHtml(order.order_number ?? order.id.slice(-6).toUpperCase())}</div>
      <div class="meta">${order.table?.number ? `Table ${order.table.number} · ` : ''}${when}</div>
    </div>
    <div class="div"></div>
    <table>
      ${rows}
    </table>
    <div class="div"></div>
    <table class="totals">
      ${totalsRow('Subtotal', order.subtotal)}
      ${totalsRow('Tax', order.tax_amount)}
      ${totalsRow('Service charge', order.service_charge)}
      ${totalsRow('Discount', order.discount_amount)}
      ${totalsRow('Total', order.total_amount, true)}
    </table>
    <div class="div"></div>
    <div class="status">${opts.paid ? `PAID${opts.mode ? ` · ${escHtml(String(opts.mode))}` : ''}` : 'NOT PAID'}</div>
    <div class="thanks">Thank you - please visit again</div>
  `

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Bill · ${escHtml(order.order_number ?? '')}</title>
  <style>
    @page { size: 58mm auto; margin: 2mm; }
    body { font-family: "Courier New", monospace; font-size: 12px; width: 54mm; margin: 0; color: #000; }
    .head { text-align: center; }
    .cafe { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
    .meta { font-size: 11px; }
    .div { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 1px 0; }
    .qty { width: 22px; }
    .name { word-break: break-word; }
    .amt { text-align: right; white-space: nowrap; }
    .note { font-size: 10px; }
    .totals td { padding-top: 2px; }
    .grand td { font-weight: bold; font-size: 13px; border-top: 1px solid #000; padding-top: 3px; }
    .status { text-align: center; font-weight: bold; font-size: 13px; }
    .thanks { text-align: center; font-size: 11px; margin-top: 4px; }
  </style>
</head>
<body>${body}</body>
</html>`

  const win = window.open('', '_blank', 'width=320,height=600')
  if (!win) {
    printInIframe(html)
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 300)
}

function printInIframe(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)

  const doc = frame.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => document.body.removeChild(frame), 1000)
  }, 300)
}
