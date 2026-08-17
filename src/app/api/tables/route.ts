import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { getDb } from '@/lib/db'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/tables?cafeId=xxx — list all tables
// POST /api/tables — generate QR codes for all tables of a cafe

export async function POST(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const { cafeId, cafeSlug } = await req.json()
    const sql = getDb()

    const tables = await sql`SELECT * FROM tables WHERE cafe_id = ${cafeId} AND is_active = true`

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const tableArr = tables as unknown as { id: string; number: number; label?: string }[]
    const qrResults = await Promise.all(
      tableArr.map(async (table) => {
        const menuUrl = `${appUrl}/menu/${table.number}?cafe=${cafeSlug}`
        const qrDataUrl = await QRCode.toDataURL(menuUrl, {
          width: 400,
          margin: 2,
          color: { dark: '#1A1A18', light: '#FFFFFF' },
          errorCorrectionLevel: 'H',
        })

        return {
          tableId: table.id,
          tableNumber: table.number,
          label: table.label,
          menuUrl,
          qrDataUrl,
        }
      })
    )

    return NextResponse.json({ data: qrResults, error: null })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const cafeId = new URL(req.url).searchParams.get('cafeId')
  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  try {
    const sql = getDb()
    const data = await sql`SELECT * FROM tables WHERE cafe_id = ${cafeId} ORDER BY number`
    return NextResponse.json({ data, error: null })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
