import postgres from 'postgres'
import { startReconcilerOnce } from '@/lib/payment/scheduler'

declare global {
  // eslint-disable-next-line no-var
  var __db: postgres.Sql | undefined
}

// Runs once per process to apply any pending in-code migrations.
// Safe to call on every startup — all statements use IF NOT EXISTS / idempotent DDL.
let migrationRan = false
async function runMigrations(sql: postgres.Sql) {
  if (migrationRan) return
  migrationRan = true
  try {
    // 007: job_type column for UPI QR bill print jobs
    await sql`
      ALTER TABLE public.kot_tickets
        ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'kot'
          CONSTRAINT kot_tickets_job_type_check
          CHECK (job_type IN ('kot', 'bill_qr'))
    `
  } catch {
    // Non-fatal: column may already exist or constraint name may differ
  }
  try {
    // 008: add-ons catalog (cafe-level)
    await sql`
      CREATE TABLE IF NOT EXISTS public.addons (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        cafe_id    UUID        NOT NULL,
        name       TEXT        NOT NULL,
        price      INTEGER     NOT NULL DEFAULT 0,
        is_active  BOOLEAN     NOT NULL DEFAULT true,
        sort_order INTEGER     NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  } catch { /* Non-fatal */ }
  try {
    // 009: addons snapshot per order item
    await sql`ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS addons_json JSONB NOT NULL DEFAULT '[]'`
  } catch { /* Non-fatal */ }
  try {
    // 010: customer suggestions / special requests at order level
    await sql`ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_note TEXT`
  } catch { /* Non-fatal */ }
}

export function getDb(): postgres.Sql {
  if (!global.__db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    global.__db = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      types: {
        // Return NUMERIC as JS number instead of string
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (n: number) => String(n),
          parse: (x: string) => parseFloat(x),
        },
        // Return TIMESTAMPTZ as ISO string (matches Supabase behaviour)
        timestamptz: {
          to: 1184,
          from: [1184],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
          parse: (x: string) => x,
        },
        // Return TIMESTAMP without tz as ISO string
        timestamp: {
          to: 1114,
          from: [1114],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
          parse: (x: string) => x,
        },
        // Return DATE as YYYY-MM-DD string (matches Supabase behaviour)
        date: {
          to: 1082,
          from: [1082],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString().slice(0, 10) : x),
          parse: (x: string) => x,
        },
      },
    })
  }
  // First DB use also arms the reconciler and runs pending migrations.
  startReconcilerOnce()
  void runMigrations(global.__db)
  return global.__db
}
