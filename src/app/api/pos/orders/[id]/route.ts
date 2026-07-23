import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'

export const dynamic = 'force-dynamic'

// GET /api/pos/orders/[id] — full order detail for the POS order-builder screen.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*), table:tables(*, section:sections(*))')
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 404 })
  return NextResponse.json({ data, error: null })
}
