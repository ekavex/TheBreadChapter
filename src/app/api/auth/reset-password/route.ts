import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDb } from '@/lib/db'
import { checkRateLimit, pruneRateLimits } from '@/lib/auth/rateLimit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const DEFAULT_PASSWORDS = new Set(['admin123', 'manager123', 'staff123'])
const RATE_LIMIT = { windowMs: 15 * 60_000, maxAttempts: 5, blockMs: 30 * 60_000 }

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  pruneRateLimits()

  const resetKey = process.env.ADMIN_RESET_KEY
  if (!resetKey) {
    return NextResponse.json(
      { error: 'Password reset is not configured on this server. Set ADMIN_RESET_KEY in the server environment.' },
      { status: 503 }
    )
  }

  const ip = clientIp(req)
  const limit = checkRateLimit(`reset:${ip}`, RATE_LIMIT)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).` },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const { userId, securityKey, newPassword } = body as {
    userId?: string
    securityKey?: string
    newPassword?: string
  }

  if (!userId || !securityKey || !newPassword) {
    return NextResponse.json({ error: 'userId, securityKey, and newPassword are required' }, { status: 400 })
  }

  if (securityKey !== resetKey) {
    logger.warn('auth.reset.invalid_key', { userId, ip })
    return NextResponse.json({ error: 'Invalid security key' }, { status: 401 })
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
  }

  if (DEFAULT_PASSWORDS.has(newPassword)) {
    return NextResponse.json({ error: 'Choose a password that is not the default demo password' }, { status: 400 })
  }

  const sql = getDb()
  const rows = await sql`
    SELECT id, role FROM auth_credentials WHERE user_id = ${userId}
  `
  const user = rows[0]

  if (!user) {
    // Don't reveal whether userId exists — same response
    return NextResponse.json({ error: 'Invalid security key' }, { status: 401 })
  }

  if ((user.role as string) !== 'admin') {
    logger.warn('auth.reset.non_admin', { userId, ip })
    return NextResponse.json({ error: 'Password reset via security key is only available for admin accounts' }, { status: 403 })
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await sql`
    UPDATE auth_credentials SET password_hash = ${passwordHash}, updated_at = now()
    WHERE id = ${user.id as string}
  `

  logger.info('auth.reset.success', { userId, ip })
  return NextResponse.json({ data: { ok: true }, error: null })
}
