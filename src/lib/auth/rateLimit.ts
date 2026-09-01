// Minimal in-process rate limiter for the login endpoint.
//
// Single-container deployment (one Node process), so an in-memory map is the
// right amount of machinery - no Redis. If the app is ever scaled to multiple
// instances this must move to the database or a shared store.

interface Bucket { count: number; firstAt: number; blockedUntil: number }

const buckets = new Map<string, Bucket>()

export interface RateLimitOptions {
  windowMs: number
  maxAttempts: number
  blockMs: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (bucket && bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) }
  }

  if (!bucket || now - bucket.firstAt > opts.windowMs) {
    buckets.set(key, { count: 1, firstAt: now, blockedUntil: 0 })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  bucket.count++
  if (bucket.count > opts.maxAttempts) {
    bucket.blockedUntil = now + opts.blockMs
    return { allowed: false, retryAfterSeconds: Math.ceil(opts.blockMs / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

// Called after a successful login so a legitimate user is not punished for
// earlier typos.
export function clearRateLimit(key: string): void {
  buckets.delete(key)
}

// Prevents unbounded growth on a long-running process.
export function pruneRateLimits(olderThanMs = 60 * 60 * 1000): void {
  const cutoff = Date.now() - olderThanMs
  const now = Date.now()
  const stale: string[] = []
  buckets.forEach((bucket, key) => {
    if (bucket.firstAt < cutoff && bucket.blockedUntil < now) stale.push(key)
  })
  for (const key of stale) buckets.delete(key)
}
