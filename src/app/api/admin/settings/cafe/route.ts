import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, requireAdmin } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// GET /api/admin/settings/cafe - tax and service charge settings
export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const sql = getDb()
    const [row] = await sql`SELECT settings FROM cafes WHERE id = ${DEMO_CAFE_ID}`
    const settings = (row?.settings ?? {}) as Record<string, unknown>
    return NextResponse.json({
      data: {
        tax_percent: Number(settings.tax_percent ?? 0),
        service_charge_percent: Number(settings.service_charge_percent ?? 0),
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

// PATCH /api/admin/settings/cafe - update tax and service charge
export async function PATCH(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const body = await req.json()
    const taxPercent = Math.max(0, Math.min(100, Number(body.tax_percent) || 0))
    const serviceChargePercent = Math.max(0, Math.min(100, Number(body.service_charge_percent) || 0))

    const sql = getDb()
    await sql`
      UPDATE cafes
      SET settings = settings
        || jsonb_build_object(
             'tax_percent', ${taxPercent}::numeric,
             'service_charge_percent', ${serviceChargePercent}::numeric
           ),
          updated_at = now()
      WHERE id = ${DEMO_CAFE_ID}
    `
    return NextResponse.json({ data: { tax_percent: taxPercent, service_charge_percent: serviceChargePercent }, error: null })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
