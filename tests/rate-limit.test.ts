import { describe, expect, it } from 'vitest'
import { checkRateLimit, clearRateLimit } from '@/lib/auth/rateLimit'

const OPTS = { windowMs: 60_000, maxAttempts: 3, blockMs: 300_000 }

describe('login rate limiting', () => {
  it('allows attempts up to the limit, then blocks', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < OPTS.maxAttempts; i++) {
      expect(checkRateLimit(key, OPTS).allowed).toBe(true)
    }
    const blocked = checkRateLimit(key, OPTS)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('keeps blocking once tripped', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < OPTS.maxAttempts + 1; i++) checkRateLimit(key, OPTS)
    expect(checkRateLimit(key, OPTS).allowed).toBe(false)
  })

  it('does not punish a user after a successful login', () => {
    const key = `test-${Math.random()}`
    checkRateLimit(key, OPTS)
    checkRateLimit(key, OPTS)
    clearRateLimit(key)
    for (let i = 0; i < OPTS.maxAttempts; i++) {
      expect(checkRateLimit(key, OPTS).allowed).toBe(true)
    }
  })

  it('tracks keys independently', () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    for (let i = 0; i < OPTS.maxAttempts + 1; i++) checkRateLimit(a, OPTS)
    expect(checkRateLimit(a, OPTS).allowed).toBe(false)
    expect(checkRateLimit(b, OPTS).allowed).toBe(true)
  })
})
