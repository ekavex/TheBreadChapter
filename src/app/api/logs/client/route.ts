import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/auth/rateLimit'
import { storeLogsNow } from '@/lib/observability/logStore'
import { parseUploadedEntries, cleanId } from '@/lib/observability/logIngest'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 200_000
const MAX_ENTRIES = 50

// POST /api/logs/client - errors reported by POS/dashboard browsers (see
// src/components/ErrorReporter.tsx). Open to signed-out pages too (the
// customer menu), so it's rate-limited per IP and size-capped; the signed-in
// user is attached when there is one.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.ip || 'unknown'
  const limit = checkRateLimit(`client-logs:${ip}`, { windowMs: 60_000, maxAttempts: 30, blockMs: 60_000 })
  if (!limit.allowed) {
    return NextResponse.json({ data: null, error: 'Too many log uploads' }, { status: 429 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ data: null, error: 'Upload too large' }, { status: 413 })
  }

  // sendBeacon posts text/plain, so read the body as text either way.
  const body = await req.text().then((t) => JSON.parse(t)).catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ data: null, error: 'Invalid JSON' }, { status: 400 })

  const session = await getSession(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  const userAgent = req.headers.get('user-agent') ?? ''
  const entries = parseUploadedEntries(
    Array.isArray(body.entries) ? body.entries.slice(0, MAX_ENTRIES) : [],
    {
      source: 'browser',
      deviceId: cleanId(body.deviceId),
      appVersion: null,
      extra: {
        ...(session ? { user: session.displayName || session.userId, role: session.role } : { user: null }),
        inAndroidApp: / wv\)/.test(userAgent),
        userAgent: userAgent.slice(0, 200),
      },
    },
  )

  try {
    return NextResponse.json({ data: { stored: await storeLogsNow(entries) }, error: null })
  } catch {
    return NextResponse.json({ data: null, error: 'Could not store logs' }, { status: 503 })
  }
}
