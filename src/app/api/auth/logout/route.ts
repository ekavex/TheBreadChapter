import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, ROLE_COOKIE_NAME } from '@/lib/auth/session'

export async function POST() {
  const res = NextResponse.json({ data: { ok: true }, error: null })
  res.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  res.cookies.set(ROLE_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return res
}
