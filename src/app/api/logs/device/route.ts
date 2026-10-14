import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { storeLogsNow } from '@/lib/observability/logStore'
import { parseUploadedEntries, cleanId } from '@/lib/observability/logIngest'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 1_000_000

// The print-bridge phone has the bridge token; staff phones running the POS
// app don't, but they carry the logged-in session cookie from the WebView.
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const expected = process.env.PRINT_BRIDGE_TOKEN?.trim()
  const provided = req.headers.get('x-print-bridge-token')?.trim()
  if (expected && provided === expected) return true
  if (await getSession(req.cookies.get(SESSION_COOKIE_NAME)?.value)) return true
  return !expected && process.env.NODE_ENV !== 'production'
}

// POST /api/logs/device - batch upload from the Android app (BreadChapterPOS
// 1.1.2+). Body: { deviceId, appVersion, deviceModel, entries: [{ ts, level,
// event, message, orderId?, data? }] }. Replies { stored } once the rows are
// in app_logs, so the phone only deletes what was actually saved.
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ data: null, error: 'Upload too large' }, { status: 413 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ data: null, error: 'Invalid JSON' }, { status: 400 })

  const deviceModel = typeof body.deviceModel === 'string' ? body.deviceModel.slice(0, 80) : undefined
  const entries = parseUploadedEntries(body.entries, {
    source: 'device',
    deviceId: cleanId(body.deviceId),
    appVersion: cleanId(body.appVersion),
    extra: deviceModel ? { deviceModel } : undefined,
  })

  try {
    const stored = await storeLogsNow(entries)
    return NextResponse.json({ data: { stored }, error: null })
  } catch (err) {
    // 503: the phone keeps the entries and retries later.
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : 'Could not store logs' },
      { status: 503 },
    )
  }
}
