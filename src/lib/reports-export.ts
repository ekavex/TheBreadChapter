// Report exporters (Module 11). Three byte formats from one ReportData shape:
// CSV (plain), Excel (.xlsx via SheetJS), PDF (via jsPDF). jsPDF is chosen
// over pdfkit specifically because pdfkit loads font metrics from disk and
// breaks under Next.js's webpack route-handler bundling; jsPDF embeds its
// fonts and has no fs dependency. Print is client-side (window.print).
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ReportData } from './reports'

function fmtMoney(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function reportTitle(data: ReportData): string {
  const from = new Date(data.window.from).toLocaleDateString('en-IN')
  const to = new Date(data.window.to).toLocaleDateString('en-IN')
  const rangeLabel = data.range.charAt(0).toUpperCase() + data.range.slice(1)
  return `Smart Cafe — ${rangeLabel} report (${from} → ${to})`
}

// ── CSV ───────────────────────────────────────────────────────
export function reportToCsv(data: ReportData): string {
  const lines: string[] = []
  const push = (header: string, rows: (string | number)[][]) => {
    lines.push(header)
    if (rows.length === 0) lines.push('(none)')
    rows.forEach((r) => lines.push(r.join(',')))
    lines.push('')
  }

  push('SUMMARY', [
    ['Revenue', fmtMoney(data.summary.revenue)],
    ['Ingredient cost', fmtMoney(data.summary.ingredientCost)],
    ['Profit', fmtMoney(data.summary.profit)],
    ['Margin %', data.summary.marginPct.toFixed(1)],
    ['Orders', data.summary.orderCount],
    ['Avg order value', fmtMoney(data.summary.avgOrderValue)],
    ['Best day', data.summary.bestDay ? `${data.summary.bestDay.label} (${fmtMoney(data.summary.bestDay.revenue)})` : '—'],
    ['Worst day', data.summary.worstDay ? `${data.summary.worstDay.label} (${fmtMoney(data.summary.worstDay.revenue)})` : '—'],
  ])
  push('TOP SELLING ITEMS', [
    ['Item', 'Quantity', 'Revenue'],
    ...data.topSellingItems.map((i) => [i.name, i.quantity, fmtMoney(i.revenue)] as (string | number)[]),
  ])
  push('AREA PERFORMANCE', [
    ['Area', 'Orders', 'Revenue', 'Top item'],
    ...data.areaPerformance.map((a) => [a.area, a.orders, fmtMoney(a.revenue), a.topItem ?? '—'] as (string | number)[]),
  ])
  push('INGREDIENT USAGE', [
    ['Ingredient', 'Quantity', 'Unit'],
    ...data.ingredientUsage.map((i) => [i.name, i.quantity, i.unit] as (string | number)[]),
  ])
  push('CUSTOMER ANALYTICS', [
    ['Total customers', data.customer.totalCustomers],
    ['New', data.customer.newCustomers],
    ['Repeat', data.customer.repeatCustomers],
    ['Most ordered item', data.customer.mostOrderedItem?.name ?? '—'],
    ['Avg bill value', fmtMoney(data.customer.avgBillValue)],
  ])
  return lines.join('\n')
}

// ── Excel ─────────────────────────────────────────────────────
export function reportToExcelBuffer(data: ReportData): Buffer {
  const wb = XLSX.utils.book_new()
  const addSheet = (name: string, aoa: (string | number)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }

  addSheet('Summary', [
    ['Metric', 'Value'],
    ['Revenue', fmtMoney(data.summary.revenue)],
    ['Ingredient cost', fmtMoney(data.summary.ingredientCost)],
    ['Profit', fmtMoney(data.summary.profit)],
    ['Margin %', Number(data.summary.marginPct.toFixed(1))],
    ['Orders', data.summary.orderCount],
    ['Avg order value', fmtMoney(data.summary.avgOrderValue)],
    ['Best day', data.summary.bestDay ? `${data.summary.bestDay.label} (${fmtMoney(data.summary.bestDay.revenue)})` : '—'],
    ['Worst day', data.summary.worstDay ? `${data.summary.worstDay.label} (${fmtMoney(data.summary.worstDay.revenue)})` : '—'],
  ])
  addSheet(
    'Top items',
    [['Item', 'Quantity', 'Revenue'], ...data.topSellingItems.map((i) => [i.name, i.quantity, fmtMoney(i.revenue)])]
  )
  addSheet(
    'Area performance',
    [['Area', 'Orders', 'Revenue', 'Top item'], ...data.areaPerformance.map((a) => [a.area, a.orders, fmtMoney(a.revenue), a.topItem ?? '—'])]
  )
  addSheet(
    'Ingredient usage',
    [['Ingredient', 'Quantity', 'Unit'], ...data.ingredientUsage.map((i) => [i.name, i.quantity, i.unit])]
  )
  addSheet('Customer', [
    ['Metric', 'Value'],
    ['Total customers', data.customer.totalCustomers],
    ['New', data.customer.newCustomers],
    ['Repeat', data.customer.repeatCustomers],
    ['Most ordered item', data.customer.mostOrderedItem?.name ?? '—'],
    ['Avg bill value', fmtMoney(data.customer.avgBillValue)],
  ])

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}

// ── PDF (jsPDF) ───────────────────────────────────────────────
export function reportToPdfBuffer(data: ReportData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text(reportTitle(data), 40, 40)
  doc.setFontSize(8)
  doc.setTextColor(110)
  doc.text('Generated by Smart Cafe Management System', 40, 54)
  doc.setTextColor(20)

  autoTable(doc, {
    startY: 70,
    head: [['Metric', 'Value']],
    body: [
      ['Revenue', fmtMoney(data.summary.revenue)],
      ['Ingredient cost', fmtMoney(data.summary.ingredientCost)],
      ['Profit', fmtMoney(data.summary.profit)],
      ['Margin %', `${data.summary.marginPct.toFixed(1)}%`],
      ['Orders', String(data.summary.orderCount)],
      ['Avg order value', fmtMoney(data.summary.avgOrderValue)],
      ['Best day', data.summary.bestDay ? `${data.summary.bestDay.label} (${fmtMoney(data.summary.bestDay.revenue)})` : '—'],
      ['Worst day', data.summary.worstDay ? `${data.summary.worstDay.label} (${fmtMoney(data.summary.worstDay.revenue)})` : '—'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 24] },
  })

  autoTable(doc, {
    head: [['Top selling items', 'Qty', 'Revenue']],
    body: data.topSellingItems.map((i) => [i.name, String(i.quantity), fmtMoney(i.revenue)]),
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 24] },
  })

  autoTable(doc, {
    head: [['Area', 'Orders', 'Revenue', 'Top item']],
    body: data.areaPerformance.map((a) => [a.area, String(a.orders), fmtMoney(a.revenue), a.topItem ?? '—']),
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 24] },
  })

  autoTable(doc, {
    head: [['Ingredient', 'Quantity', 'Unit']],
    body: data.ingredientUsage.map((i) => [i.name, String(i.quantity), i.unit]),
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 24] },
  })

  autoTable(doc, {
    head: [['Customer metric', 'Value']],
    body: [
      ['Total customers', String(data.customer.totalCustomers)],
      ['New', String(data.customer.newCustomers)],
      ['Repeat', String(data.customer.repeatCustomers)],
      ['Most ordered item', data.customer.mostOrderedItem?.name ?? '—'],
      ['Avg bill value', fmtMoney(data.customer.avgBillValue)],
    ],
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 24] },
  })

  return Buffer.from(doc.output('arraybuffer'))
}
