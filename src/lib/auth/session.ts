// ─── Flat two-credential auth (Module 9 — no roles) ───────────
// Not Supabase Auth. A signed, stateless token: {scope, exp} + HMAC.
// Uses Web Crypto (SubtleCrypto), not Node's `crypto` module, so the same
// code runs in both the Edge middleware and Node API routes.
// Used two ways:
//   1. Dashboard session cookie (long TTL) — set on /login success.
//   2. Menu-CRUD action token (short TTL) — set on a successful popup
//      credential check, then required per mutating menu request.
import type { AuthScope } from '@/lib/types'

const SESSION_COOKIE = 'sc_session'
const DASHBOARD_TTL_SECONDS = 12 * 60 * 60 // 12h
const MENU_CRUD_TTL_SECONDS = 2 * 60 // 2min — re-verified per action, not a session

interface TokenPayload {
  scope: AuthScope
  exp: number // unix seconds
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
    return payload
  } catch {
    return null
  }
}

export async function createDashboardSessionToken(): Promise<string> {
  return sign({ scope: 'dashboard', exp: Math.floor(Date.now() / 1000) + DASHBOARD_TTL_SECONDS })
}

export async function createMenuCrudActionToken(): Promise<string> {
  return sign({ scope: 'menu_crud', exp: Math.floor(Date.now() / 1000) + MENU_CRUD_TTL_SECONDS })
}

export async function verifyScope(token: string | undefined | null, scope: AuthScope): Promise<boolean> {
  const payload = await verify(token)
  return payload?.scope === scope
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
export const DASHBOARD_SESSION_TTL_SECONDS = DASHBOARD_TTL_SECONDS
