// Module 8 customer identity — optional phone capture at payment. Phone-keyed
// upsert: creates customer on first order, bumps stats on repeat. Skipped
// entirely if no phone given (anonymous walk-in). Auto-tagging/stats triggers
// from the original schema handle total_orders/total_spent/last_visit_at —
// this helper just resolves-or-creates the customer row so orders can FK to it.
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { createAdminClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createAdminClient>

// Normalize to 10-digit (strip +91, spaces, dashes). Returns null if unusable.
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '').replace(/^91/, '').slice(-10)
  return digits.length === 10 ? digits : null
}

export async function upsertCustomer(
  supabase: Supabase,
  phone: string | null | undefined,
  name: string | null | undefined
): Promise<string | null> {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('cafe_id', DEMO_CAFE_ID)
    .eq('phone', normalized)
    .maybeSingle()

  if (existing) {
    if (name) {
      await supabase.from('customers').update({ name }).eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created } = await supabase
    .from('customers')
    .insert({ cafe_id: DEMO_CAFE_ID, phone: normalized, name: name || null })
    .select('id')
    .single()

  return created?.id ?? null
}
