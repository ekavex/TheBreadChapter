import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials } from '@/lib/auth/credentials'
import { createSession, SESSION_COOKIE_NAME, ROLE_COOKIE_NAME, DASHBOARD_SESSION_TTL_SECONDS } from '@/lib/auth/session'
import { checkRateLimit, clearRateLimit, pruneRateLimits } from '@/lib/auth/rateLimit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = { windowMs: 5 * 60_000, maxAttempts: 8, blockMs: 15 * 60_000 }

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  pruneRateLimits()

  const body = await req.json().catch(() => ({}))
  const { userId, password } = body as { userId?: string; password?: string }
  if (!userId || !password) {
    return NextResponse.json({ error: 'userId and password required' }, { status: 400 })
  }

  // Two buckets: per-IP stops a single attacker, per-user stops a distributed
  // guess against one account.
  const ip = clientIp(req)
  for (const key of [`ip:${ip}`, `user:${userId.toLowerCase()}`]) {
    const limit = checkRateLimit(key, RATE_LIMIT)
    if (!limit.allowed) {
      logger.warn('auth.login.rate_limited', { key, ip })
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      )
    }
  }

  const result = await verifyCredentials(userId, password)
  if (!result) {
    logger.warn('auth.login.failed', { userId, ip })
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  clearRateLimit(`ip:${ip}`)
  clearRateLimit(`user:${userId.toLowerCase()}`)

  const { role, displayName } = result
  const token = await createSession(userId, role, displayName)
  logger.info('auth.login.success', { userId, role, ip })

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
