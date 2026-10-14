import { describe, it, expect } from 'vitest'
import { scrubSecrets } from '@/lib/observability/logStore'
import { parseUploadedEntries, cleanId, MAX_ENTRIES_PER_UPLOAD } from '@/lib/observability/logIngest'

describe('scrubSecrets', () => {
  it('removes tokens, passwords and bearer credentials from messages', () => {
    expect(scrubSecrets('GET /api/pos/print-jobs?station=all&token=abc123secret')).toBe('GET /api/pos/print-jobs?station=all&token=[redacted]')
    expect(scrubSecrets('{"userId":"manager","password":"ChangeMe!"}')).toBe('{"userId":"manager","password":"[redacted]"}')
    expect(scrubSecrets('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe('Authorization: Bearer [redacted]')
    expect(scrubSecrets('"security_token": "s3cr3t"')).toBe('"security_token": "[redacted]"')
  })

  it('leaves ordinary text alone', () => {
    expect(scrubSecrets('Printed Bill for table Indoor 4 (job 42)')).toBe('Printed Bill for table Indoor 4 (job 42)')
  })
})

describe('parseUploadedEntries', () => {
  const ctx = { source: 'device' as const, deviceId: 'android-1a2b3c4d', appVersion: '1.1.2', extra: { deviceModel: 'Xiaomi Redmi 9' } }

  it('keeps known fields and tags every entry with the device', () => {
    const [e] = parseUploadedEntries([
      { ts: 1760000000000, level: 'warn', event: 'print.partial', message: 'dropped', orderId: 'abc', data: { bytes: 10 }, evil: 'x' },
    ], ctx)
    expect(e).toEqual({
      loggedAt: 1760000000000, source: 'device', level: 'warn', event: 'print.partial', message: 'dropped', orderId: 'abc',
      deviceId: 'android-1a2b3c4d', appVersion: '1.1.2', data: { bytes: 10, deviceModel: 'Xiaomi Redmi 9' },
    })
  })

  it('defaults bad levels, drops non-objects, and caps the batch', () => {
    const out = parseUploadedEntries([{ level: 'catastrophic', event: 'x' }, 'junk', null, 7], ctx)
    expect(out).toHaveLength(1)
    expect(out[0].level).toBe('info')
    expect(parseUploadedEntries(new Array(MAX_ENTRIES_PER_UPLOAD + 50).fill({ event: 'e' }), ctx)).toHaveLength(MAX_ENTRIES_PER_UPLOAD)
    expect(parseUploadedEntries('not an array', ctx)).toEqual([])
  })

  it('truncates long messages and event names', () => {
    const [e] = parseUploadedEntries([{ event: 'e'.repeat(500), message: 'm'.repeat(10_000) }], ctx)
    expect(e.event).toHaveLength(100)
    expect(e.message).toHaveLength(2000)
  })
})

describe('cleanId', () => {
  it('accepts device ids and versions, rejects anything else', () => {
    expect(cleanId('android-1a2b3c4d')).toBe('android-1a2b3c4d')
    expect(cleanId('1.1.2')).toBe('1.1.2')
    expect(cleanId("x'; DROP TABLE app_logs;--")).toBeNull()
    expect(cleanId(42)).toBeNull()
  })
})
