import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

const REQUEST_ID_HEADER = 'x-request-id'

// Correlation id for every request, so one payment can be traced across the
// pay route, the webhook and the reconciler in the logs.
function withRequestId(req: NextRequest): { headers: Headers; requestId: string } {
  const headers = new Headers(req.headers)
  const requestId = headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID()
  headers.set(REQUEST_ID_HEADER, requestId)
  return { headers, requestId }
}

function pass(requestHeaders: Headers, requestId: string) {
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set(REQUEST_ID_HEADER, requestId)
  return res
}

export async function middleware(req: NextRequest) {
  const { headers: requestHeaders, requestId } = withRequestId(req)
  const { pathname } = req.nextUrl

  // API routes carry their own authorization (each handler guards itself, and
  // some are deliberately public: customer menu, order tracking, webhook).
  // Middleware only stamps them with a correlation id.
  if (pathname.startsWith('/api/')) return pass(requestHeaders, requestId)

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await getSession(token)

  if (!session) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', pathname)
    const redirect = NextResponse.redirect(loginUrl)
    redirect.headers.set(REQUEST_ID_HEADER, requestId)
    return redirect
  }

  // Admin/manager area - staff cannot manage users
  if (pathname.startsWith('/dashboard/admin') && session.role === 'staff') {
    const redirect = NextResponse.redirect(new URL('/dashboard', req.url))
    redirect.headers.set(REQUEST_ID_HEADER, requestId)
    return redirect
  }

  return pass(requestHeaders, requestId)
}

export const config = {
  matcher: ['/dashboard/:path*', '/pos/:path*', '/kitchen/:path*', '/kitchen', '/api/:path*'],
}
