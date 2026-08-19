import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { loadPrinterConfig, buildPrinterService } from '@/lib/printer'
import { logger } from '@/lib/logger'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { KotStation, MenuItemCategory } from '@/lib/types'

const STATION_BY_CATEGORY: Record<MenuItemCategory, KotStation> = {
  food: 'kitchen',
  beverage: 'beverage_counter',
}

async function fetchOrderWithItems(orderId: string) {
  const sql = getDb()
  const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY created_at`
  const [tableRow] = order?.table_id
    ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
    : [undefined]
  return { ...order, items, table: tableRow ?? null }
}

// POST /api/pos/orders/[id]/kot — Module 5 "KOT Routing": on confirm, split
// the order by category and print a ticket per station (food → kitchen,
// beverage → beverage counter). Table → kot_sent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const printerCfg = await loadPrinterConfig(sql, DEMO_CAFE_ID)
    const printerService = buildPrinterService(printerCfg)

    const [order] = await sql`SELECT * FROM orders WHERE id = ${params.id}`
    if (!order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (!['OPEN', 'KOT_SENT'].includes(order.pos_status)) {
      return NextResponse.json({ data: null, error: `Order is already ${order.pos_status}` }, { status: 409 })
    }

    const isAddon = order.pos_status === 'KOT_SENT'

    // For add-on KOT: only items added after the last kot_sent_at are included.
    const allOrderItems = await sql`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY created_at`
    type DbOrderItem = { category?: MenuItemCategory; name: string; quantity: number; created_at: string }
    const allTyped = allOrderItems as unknown as DbOrderItem[]

    const orderItems = isAddon && order.kot_sent_at
      ? allTyped.filter((i) => new Date(i.created_at) > new Date(order.kot_sent_at))
      : allTyped

    if (orderItems.length === 0) {
      return NextResponse.json({
        data: null,
        error: isAddon ? 'No new items to send — add items first' : 'Add at least one item before sending to the kitchen',
      }, { status: 400 })
    }

    const [tableRow] = order.table_id
      ? await sql`SELECT * FROM tables WHERE id = ${order.table_id}`
      : [undefined]
    const table = tableRow ?? null

    // For the first KOT, skip stations already ticketed (retry-safe).
    // For add-on KOT, always insert a new ticket — different items, same station is fine.
    const alreadyTicketed = new Set<string>()
    if (!isAddon) {
      const ticketRows = await sql`SELECT station FROM kot_tickets WHERE order_id = ${order.id}`
      for (const t of ticketRows as unknown as { station: string }[]) alreadyTicketed.add(t.station)
    }

    const stations: KotStation[] = ['kitchen', 'beverage_counter']
    let printerWarning: string | null = null
    for (const station of stations) {
      const items = orderItems
        .filter((i) => STATION_BY_CATEGORY[i.category ?? 'food'] === station)
        .map((i) => ({ name: i.name, quantity: i.quantity }))

      if (items.length === 0) continue
      if (alreadyTicketed.has(station)) {
        logger.warn('kot.print.skipped_duplicate', { orderId: order.id, station })
        continue
      }

      logger.info('kot.print.start', { orderId: order.id, station, itemCount: items.length, isAddon })
      try {
        await printerService.printTicket({
          tableNumber: table!.number,
          orderId: order.id,
          station,
          items,
        })
        logger.info('kot.print.success', { orderId: order.id, station })
      } catch (printErr) {
        printerWarning = printErr instanceof Error ? printErr.message : String(printErr)
        logger.error('kot.print.error', { orderId: order.id, station, error: printerWarning })
      }

      const printStatus = process.env.PRINT_BRIDGE_TOKEN ? 'queued' : 'mock_printed'
      await sql`INSERT INTO kot_tickets (order_id, station, items_json, print_status) VALUES (${order.id}, ${station}, ${sql.json(items)}, ${printStatus})`
    }

    const now = new Date().toISOString()

    if (!isAddon) {
      await sql`UPDATE tables SET status = 'kot_sent' WHERE id = ${order.table_id}`
      await sql`
        UPDATE orders
        SET pos_status = 'KOT_SENT', kot_sent_at = ${now}, status = 'confirmed', confirmed_at = ${now}
        WHERE id = ${params.id}
      `
    } else {
      // Add-on: just advance the kot_sent_at watermark so the next add-on batch starts fresh
      await sql`UPDATE orders SET kot_sent_at = ${now} WHERE id = ${params.id}`
    }

    const updatedOrder = await fetchOrderWithItems(params.id)
    return NextResponse.json({ data: updatedOrder, error: null, printerWarning: printerWarning ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send KOT'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
