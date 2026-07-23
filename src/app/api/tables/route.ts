import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/server'

// GET /api/tables?cafeId=xxx — list all tables
// POST /api/tables — generate QR codes for all tables of a cafe

export async function POST(req: NextRequest) {
  const { cafeId, cafeSlug } = await req.json()
  const supabase = createAdminClient()

  const { data: tables, error } = await supabase
    .from('tables')
    .select('*')
    .eq('cafe_id', cafeId)
    .eq('is_active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const qrResults = await Promise.all(
    (tables ?? []).map(async (table) => {
      const menuUrl = `${appUrl}/menu/${table.number}?cafe=${cafeSlug}`
      const qrDataUrl = await QRCode.toDataURL(menuUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#1A1A18', light: '#FFFFFF' },
        errorCorrectionLevel: 'H',
      })

      // Store QR in Supabase Storage (optional — can also use dataURL directly)
      // const buffer = Buffer.from(qrDataUrl.split(',')[1], 'base64')
      // await supabase.storage.from('qr-codes').upload(`${cafeSlug}/table-${table.number}.png`, buffer)

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
}

export async function GET(req: NextRequest) {
  const cafeId = new URL(req.url).searchParams.get('cafeId')
  if (!cafeId) return NextResponse.json({ error: 'cafeId required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .eq('cafe_id', cafeId)
    .order('number')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, error: null })
}
