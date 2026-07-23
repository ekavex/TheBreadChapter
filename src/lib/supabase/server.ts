// ─── Server client (use in Server Components + API routes) ──
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types'

// Next.js's App Router patches the global `fetch` and caches GET requests by
// default — including the ones @supabase/supabase-js makes to PostgREST.
// Without this, `export const dynamic = 'force-dynamic'` on a route is not
// reliably enough to stop live operational data (table/order status, stock
// levels, etc.) from being served stale. Forcing `cache: 'no-store'` here,
// once, is the actually-effective fix.
function noStoreFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, cache: 'no-store' })
}

export function createServerSupabaseClient() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set(name, value, options) {
          try { cookieStore.set({ name, value, ...options }) } catch {}
        },
        remove(name, options) {
          try { cookieStore.set({ name, value: '', ...options }) } catch {}
        },
      },
      global: { fetch: noStoreFetch },
    }
  )
}

// Service role client — bypasses RLS — only use in trusted API routes
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: noStoreFetch } }
  )
}
