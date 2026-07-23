import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials } from '@/lib/auth/credentials'
import { createDashboardSessionToken, SESSION_COOKIE_NAME, DASHBOARD_SESSION_TTL_SECONDS } from '@/lib/auth/session'

export async function POST(req: NextRequest) {
  const { userId, password } = await req.json()
  if (!userId || !password) {
    return NextResponse.json({ error: 'userId and password required' }, { status: 400 })
  }

  const ok = await verifyCredentials('dashboard', userId, password)
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await createDashboardSessionToken()
  const res = NextResponse.json({ data: { ok: true }, error: null })
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS,
  })
  return res
}
