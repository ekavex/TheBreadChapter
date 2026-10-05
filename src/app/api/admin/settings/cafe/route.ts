import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, requireAdmin } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// FSSAI licence / registration numbers are 14 digits.
const FSSAI_RE = /^\d{14}$/

// GET /api/admin/settings/cafe - tax, service charge and bill details
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
        fssai_number: typeof settings.fssai_number === 'string' ? settings.fssai_number : '',
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

// PATCH /api/admin/settings/cafe - admin only. Updates just the fields sent,
// so the tax form and the bill-details form don't overwrite each other.
// An empty fssai_number removes it (and it then stops printing on bills).
export async function PATCH(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard
  const roleGuard = await requireAdmin(req)
  if (roleGuard) return roleGuard

  try {
    const body = await req.json()
    const updates: Record<string, number | string> = {}
    if ('tax_percent' in body) {
      updates.tax_percent = Math.max(0, Math.min(100, Number(body.tax_percent) || 0))
    }
    if ('service_charge_percent' in body) {
      updates.service_charge_percent = Math.max(0, Math.min(100, Number(body.service_charge_percent) || 0))
    }
    let removeFssai = false
    if ('fssai_number' in body) {
      const fssai = String(body.fssai_number ?? '').replace(/\s+/g, '')
      if (fssai === '') {
        removeFssai = true
      } else if (!FSSAI_RE.test(fssai)) {
        return NextResponse.json({ data: null, error: 'FSSAI number must be exactly 14 digits' }, { status: 400 })
      } else {
        updates.fssai_number = fssai
      }
    }
    if (Object.keys(updates).length === 0 && !removeFssai) {
      return NextResponse.json({ data: null, error: 'No settings to update' }, { status: 400 })
    }

    const sql = getDb()
    const [row] = await sql`
      UPDATE cafes
      SET settings = (settings || ${sql.json(updates)}::jsonb) - ${removeFssai ? 'fssai_number' : ''}::text,
          updated_at = now()
      WHERE id = ${DEMO_CAFE_ID}
      RETURNING settings
    `
    const settings = (row?.settings ?? {}) as Record<string, unknown>
    return NextResponse.json({
      data: {
        tax_percent: Number(settings.tax_percent ?? 0),
        service_charge_percent: Number(settings.service_charge_percent ?? 0),
        fssai_number: typeof settings.fssai_number === 'string' ? settings.fssai_number : '',
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
