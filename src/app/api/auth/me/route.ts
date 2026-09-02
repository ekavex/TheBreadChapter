import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'

// GET /api/auth/me - the logged-in user's own role + display name.
// Used by the dashboard sidebar; sc_session is httpOnly so the client can't
// read displayName off a cookie the way it does for role (sc_role).
export async function GET(req: NextRequest) {
  const guard = await requireDashboardSession(req)
  if (guard) return guard

  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ data: null, error: 'Authentication required' }, { status: 401 })
  }

  return NextResponse.json({
    data: { role: user.role, displayName: user.displayName },
    error: null,
  })
}
