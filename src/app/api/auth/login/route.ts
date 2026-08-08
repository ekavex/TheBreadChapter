import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials } from '@/lib/auth/credentials'
import { createSession, SESSION_COOKIE_NAME, ROLE_COOKIE_NAME, DASHBOARD_SESSION_TTL_SECONDS } from '@/lib/auth/session'

export async function POST(req: NextRequest) {
  const { userId, password } = await req.json()
  if (!userId || !password) {
    return NextResponse.json({ error: 'userId and password required' }, { status: 400 })
  }

  const result = await verifyCredentials(userId, password)
  if (!result) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const { role, displayName } = result
  const token = await createSession(userId, role)

  const cookieOpts = {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS,
  }

  const res = NextResponse.json({ data: { role, displayName }, error: null })
  // httpOnly session token — the signed credential
  res.cookies.set(SESSION_COOKIE_NAME, token, { ...cookieOpts, httpOnly: true })
  // Non-httpOnly role cookie — readable by client-side JS for nav filtering
  res.cookies.set(ROLE_COOKIE_NAME, role, { ...cookieOpts, httpOnly: false })
  return res
}
