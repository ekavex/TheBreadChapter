import { NextRequest, NextResponse } from 'next/server'
import { verifyScope, SESSION_COOKIE_NAME } from './session'

// Defense in depth for API routes reachable outside the middleware-gated
// /dashboard/* pages (e.g. called directly, not through the UI). Menu CRUD
// routes require both this AND requireMenuCrudToken — the menu-crud token
// alone isn't enough to prove the caller is an actively logged-in manager.
export async function requireDashboardSession(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const ok = await verifyScope(token, 'dashboard')
  if (!ok) {
    return NextResponse.json({ error: 'Dashboard session required' }, { status: 401 })
  }
  return null
}
