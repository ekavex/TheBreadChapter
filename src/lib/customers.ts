import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '').replace(/^91/, '').slice(-10)
  return digits.length === 10 ? digits : null
}

// `exec` lets a caller run this inside an open transaction (see
// lib/payment/finalize.ts) so customer capture commits atomically with the
// payment. Defaults to the shared pool.
export async function upsertCustomer(
  phone: string | null | undefined,
  name: string | null | undefined,
  exec?: ReturnType<typeof getDb>
): Promise<string | null> {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const sql = exec ?? getDb()
  const rows = await sql`
    SELECT id FROM customers
    WHERE cafe_id = ${DEMO_CAFE_ID} AND phone = ${normalized}
  `
  const existing = rows[0]

  if (existing) {
    if (name) {
      await sql`UPDATE customers SET name = ${name} WHERE id = ${existing.id}`
    }
    return existing.id as string
  }

  const [created] = await sql`
    INSERT INTO customers (cafe_id, phone, name)
    VALUES (${DEMO_CAFE_ID}, ${normalized}, ${name ?? null})
    RETURNING id
  `
  return (created?.id as string) ?? null
}
