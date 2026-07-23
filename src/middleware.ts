import { NextRequest, NextResponse } from 'next/server'
import { verifyScope, SESSION_COOKIE_NAME } from '@/lib/auth/session'

// Gates /dashboard and /pos behind the single dashboard-access credential
// (Module 9 — no roles, just one gate). Menu-CRUD is a separate, per-action
// popup check enforced at the API route level, not here.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const ok = await verifyScope(token, 'dashboard')

  if (!ok) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/pos/:path*'],
}
