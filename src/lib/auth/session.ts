// ─── HMAC-signed stateless session (RBAC-aware) ─────────────
// Payload: { userId, role, exp }
// Uses Web Crypto (SubtleCrypto) - runs in both Edge middleware and Node routes.
import type { UserRole } from '@/lib/types'

export const SESSION_COOKIE_NAME = 'sc_session'
export const ROLE_COOKIE_NAME = 'sc_role'
export const DASHBOARD_SESSION_TTL_SECONDS = 12 * 60 * 60        // 12h  (default)
export const REMEMBER_ME_TTL_SECONDS       = 30 * 24 * 60 * 60  // 30 days

interface TokenPayload {
  userId: string
  role: UserRole
  displayName: string
  exp: number
}

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let str = ''
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  return atob(b64)
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SESSION_SECRET
  if (!secret) throw new Error('AUTH_SESSION_SECRET is not set')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function sign(payload: TokenPayload): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await getKey()
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return `${body}.${base64UrlEncode(sigBuf)}`
}

async function verify(token: string | undefined | null): Promise<TokenPayload | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const key = await getKey()
  const sigBytes = Uint8Array.from(base64UrlDecodeToString(sig), (c) => c.charCodeAt(0))
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body))
  if (!valid) return null

  try {
    const payload = JSON.parse(base64UrlDecodeToString(body)) as TokenPayload
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    if (!payload.userId || !payload.role) return null
    payload.displayName = payload.displayName ?? ''
    return payload
  } catch {
    return null
  }
}

export async function createSession(
  userId: string,
  role: UserRole,
  displayName: string,
  ttlSeconds: number = DASHBOARD_SESSION_TTL_SECONDS,
): Promise<string> {
  return sign({ userId, role, displayName, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
}

export async function getSession(
  token: string | undefined | null
): Promise<{ userId: string; role: UserRole; displayName: string } | null> {
  const payload = await verify(token)
  if (!payload) return null
  return { userId: payload.userId, role: payload.role, displayName: payload.displayName }
}
