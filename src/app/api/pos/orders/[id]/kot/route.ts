import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { printerService } from '@/lib/printer/MockPrinterService'
import { logger } from '@/lib/logger'
import type { KotStation, MenuItemCategory } from '@/lib/types'

const STATION_BY_CATEGORY: Record<MenuItemCategory, KotStation> = {
  food: 'kitchen',
  beverage: 'beverage_counter',
}

// POST /api/pos/orders/[id]/kot — Module 5 "KOT Routing": on confirm, split
// the order by category and print a ticket per station (food → kitchen,
// beverage → beverage counter). Table → kot_sent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, items:order_items(*), table:tables(*)')
      .eq('id', params.id)
      .single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    if (order.pos_status !== 'OPEN') {
      return NextResponse.json({ data: null, error: `Order is already ${order.pos_status}` }, { status: 409 })
    }
    if (!order.items || order.items.length === 0) {
      return NextResponse.json({ data: null, error: 'Add at least one item before sending to the kitchen' }, { status: 400 })
    }

    // A retry after a partial failure below (e.g. station A printed fine but
    // station B's ticket insert threw) must not reprint a station that's
    // already been ticketed — order stays OPEN until every station succeeds,
    // so a naive retry would otherwise double-print station A.
    const { data: existingTickets } = await supabase.from('kot_tickets').select('station').eq('order_id', order.id)
    const alreadyTicketed = new Set((existingTickets ?? []).map((t) => t.station))

    const stations: KotStation[] = ['kitchen', 'beverage_counter']
    for (const station of stations) {
      const items = order.items
        .filter((i) => STATION_BY_CATEGORY[i.category ?? 'food'] === station)
        .map((i) => ({ name: i.name, quantity: i.quantity }))

      if (items.length === 0) continue
      if (alreadyTicketed.has(station)) {
        logger.warn('kot.print.skipped_duplicate', { orderId: order.id, station })
        continue
      }

      logger.info('kot.print.start', { orderId: order.id, station, itemCount: items.length })
      try {
        await printerService.printTicket({
          tableNumber: order.table!.number,
          orderId: order.id,
          station,
          items,
        })
      } catch (printErr) {
        logger.error('kot.print.error', {
          orderId: order.id,
          station,
          error: printErr instanceof Error ? printErr.message : String(printErr),
        })
        throw printErr
      }
      logger.info('kot.print.success', { orderId: order.id, station })

      const { error: ticketError } = await supabase.from('kot_tickets').insert({
        order_id: order.id,
        station,
        items_json: items,
      })
      if (ticketError) throw ticketError
    }

    const { error: tableError } = await supabase.from('tables').update({ status: 'kot_sent' }).eq('id', order.table_id)
    if (tableError) throw tableError

    const now = new Date().toISOString()
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({ pos_status: 'KOT_SENT', kot_sent_at: now, status: 'confirmed', confirmed_at: now })
      .eq('id', params.id)
      .select('*, items:order_items(*), table:tables(*)')
      .single()
    if (updateError) throw updateError

    return NextResponse.json({ data: updatedOrder, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send KOT'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
