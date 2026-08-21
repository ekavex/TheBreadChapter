import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { requireAdmin } from '@/lib/auth/requireDashboardSession'
import { loadPrinterConfig, buildPrinterService } from '@/lib/printer'
import { buildTestPayload, writeToDevice } from '@/lib/printer/escpos'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// GET /api/admin/settings/printers — current printer config (DB merged over env)
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const sql = getDb()
    const cfg = await loadPrinterConfig(sql, DEMO_CAFE_ID)
    return NextResponse.json({ data: cfg, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

// PATCH /api/admin/settings/printers — save printer config to cafes.settings
export async function PATCH(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const body = await req.json()
    const printers = {
      kitchen: {
        btDevice:  body.kitchen?.btDevice  ?? '',
        usbDevice: body.kitchen?.usbDevice ?? '',
        ip:        body.kitchen?.ip        ?? '',
      },
      beverage_counter: {
        btDevice:  body.beverage_counter?.btDevice  ?? '',
        usbDevice: body.beverage_counter?.usbDevice ?? '',
        ip:        body.beverage_counter?.ip        ?? '',
      },
    }

    const sql = getDb()
    await sql`
      UPDATE cafes
      SET settings = jsonb_set(settings, '{printers}', ${sql.json(printers)}::jsonb, true),
          updated_at = now()
      WHERE id = ${DEMO_CAFE_ID}
    `
    return NextResponse.json({ data: printers, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

// POST /api/admin/settings/printers?action=test&station=kitchen
export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  const { searchParams } = new URL(req.url)
  const station = searchParams.get('station') ?? 'kitchen'

  try {
    const sql = getDb()
    const cfg = await loadPrinterConfig(sql, DEMO_CAFE_ID)
    const stationCfg = station === 'kitchen' ? cfg.kitchen : cfg.beverage_counter

    const payload = buildTestPayload(station)
    const tried: string[] = []
    let usedMethod = ''

    if (stationCfg.btDevice) {
      try {
        await writeToDevice(stationCfg.btDevice, payload)
        usedMethod = `Bluetooth (${stationCfg.btDevice})`
      } catch {
        tried.push(`BT(${stationCfg.btDevice})`)
      }
    }

    if (!usedMethod && stationCfg.usbDevice) {
      try {
        await writeToDevice(stationCfg.usbDevice, payload)
        usedMethod = `USB (${stationCfg.usbDevice})`
      } catch {
        tried.push(`USB(${stationCfg.usbDevice})`)
      }
    }

    if (!usedMethod && stationCfg.ip) {
      const { NetworkPrinterService } = await import('@/lib/printer/NetworkPrinterService')
      const svc = new NetworkPrinterService({ [station]: stationCfg.ip })
      await svc.printTicket({ tableLabel: 'Test', orderId: 'test-print', station: station as 'kitchen' | 'beverage_counter', items: [{ name: 'Test Item', quantity: 1 }] })
      usedMethod = `Network (${stationCfg.ip})`
    }

    if (!usedMethod) {
      return NextResponse.json(
        { data: null, error: `No printer configured or reachable for ${station}. Tried: ${tried.join(', ') || 'nothing configured'}` },
        { status: 422 }
      )
    }

    return NextResponse.json({ data: { method: usedMethod }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
