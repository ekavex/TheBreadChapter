import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await getSession(token)
  const { pathname } = req.nextUrl

  if (!session) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { role } = session

  // Admin-only area
  if (pathname.startsWith('/dashboard/admin')) {
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  // Staff can only access POS and menu-manager within the dashboard
  if (pathname.startsWith('/dashboard') && role === 'staff') {
    if (!pathname.startsWith('/dashboard/menu-manager')) {
      return NextResponse.redirect(new URL('/pos', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/pos/:path*'],
}
