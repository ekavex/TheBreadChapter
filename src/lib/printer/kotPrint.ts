// Browser-only: opens a styled popup and calls window.print() so any printer
// the device can see (Bluetooth paired, USB, or network) can print the KOT.
// Formatted for 58 mm (2-inch) thermal paper — 32 character columns.

interface OrderForPrint {
  id: string
  customer_note?: string | null
  items?: {
    name: string
    quantity: number
    category?: string | null
    addons_json?: { name: string }[] | null
  }[] | null
  table?: { number?: number | null } | null
}

export function printKot(order: OrderForPrint): void {
  const allItems = order.items ?? []
  if (allItems.length === 0) return

  const kitchenItems  = allItems.filter((i) => i.category !== 'beverage')
  const beverageItems = allItems.filter((i) => i.category === 'beverage')

  const tableNum = order.table?.number ?? '?'
  const shortId  = order.id.slice(-6).toUpperCase()
  const time     = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  const note = order.customer_note?.trim() ?? ''

  function kotBlock(station: string, items: typeof allItems): string {
    const rows = items
      .map((i) => {
        const addonNames = (i.addons_json ?? []).map((a) => a.name).filter(Boolean)
        const addonLine = addonNames.length > 0
          ? `<div class="addon">${addonNames.map(escHtml).join(', ')}</div>`
          : ''
        return `<div class="item"><span class="qty">${i.quantity}x</span>${escHtml(i.name)}</div>${addonLine}`
      })
      .join('')
    const noteBlock = note ? `<div class="div">--------------------------------</div><div class="note"><b>NOTE:</b> ${escHtml(note)}</div>` : ''
    return `
      <div class="kot">
        <div class="meta">Table&nbsp;${tableNum}&nbsp;·&nbsp;${time}</div>
        <div class="meta">Order&nbsp;#${shortId}</div>
        <div class="div">--------------------------------</div>
        ${rows}
        ${noteBlock}
        <div class="div">--------------------------------</div>
      </div>`
  }

  const blocks = [
    ...(kitchenItems.length  > 0 ? [kotBlock('BARISTA',  kitchenItems)]  : []),
    ...(beverageItems.length > 0 ? [kotBlock('BEVERAGE', beverageItems)] : []),
  ]
  if (blocks.length === 0) return

  const win = window.open('', '_blank', 'width=300,height=560')
  if (!win) {
    // Popup blocked — fallback: print in the current window's iframe
    printInIframe(blocks.join(''))
    return
  }

  win.document.write(buildHtml(tableNum, blocks.join('')))
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 300)
}

// ─── Helpers ──────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildHtml(tableNum: number | string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KOT · Table ${tableNum}</title>
  <style>
    @page {
      size: 58mm auto;
      margin: 2mm 1mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      width: 56mm;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    .kot {
      padding: 2mm 0;
      page-break-after: always;
    }
    .kot:last-child { page-break-after: auto; }
    .station {
      font-size: 18px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 3px;
      padding: 3mm 0 2mm;
    }
    .meta {
      text-align: center;
      font-size: 10px;
      margin: 1px 0;
    }
    .div {
      text-align: center;
      margin: 3px 0;
      font-size: 11px;
    }
    .item {
      font-size: 13px;
      font-weight: bold;
      margin: 4px 1mm 0;
      word-break: break-word;
    }
    .addon {
      font-size: 11px;
      font-weight: normal;
      margin: 0 1mm 4px 24px;
      color: #333;
    }
    .note {
      font-size: 11px;
      margin: 3px 1mm;
      word-break: break-word;
    }
    .qty {
      display: inline-block;
      min-width: 22px;
    }
  </style>
</head>
<body>${body}</body>
</html>`
}

// Fallback when popups are blocked — inject a hidden iframe and print from it
function printInIframe(body: string): void {
  const existing = document.getElementById('__kot_iframe__')
  if (existing) existing.remove()

  const iframe = document.createElement('iframe')
  iframe.id = '__kot_iframe__'
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(buildHtml('?', body))
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.print()
    setTimeout(() => iframe.remove(), 1000)
  }, 300)
}
