import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE_NAME } from './session'
import type { UserRole } from '@/lib/types'

// Accepts any authenticated session (admin | manager | staff).
// All 40+ API routes use this name — keeping it unchanged avoids mass edits.
export async function requireDashboardSession(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return null
}

// Returns the authenticated user or null — for routes that need to act on role.
export async function getSessionUser(
  req: NextRequest
): Promise<{ userId: string; role: UserRole; displayName: string } | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  return getSession(token)
}

// Returns 403 if the caller is not manager or admin.
export async function requireManagerOrAdmin(req: NextRequest): Promise<NextResponse | null> {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (user.role === 'staff') return NextResponse.json({ error: 'Manager access required' }, { status: 403 })
  return null
}

// Returns 403 if the caller is not admin.
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return null
}
