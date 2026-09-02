// Runs once on server startup (Next.js 14 instrumentation hook).
// Migrations are embedded inline - no file-path dependency inside Docker.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Each entry: [filename_key, sql_to_run]
  // Add new migrations here in order. Never edit or remove existing entries.
  const migrations: [string, string][] = [
    [
      '007_menu_variants',
      `ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT NULL;`,
    ],
    [
      '008_kot_tickets_taken_by',
      `ALTER TABLE kot_tickets ADD COLUMN IF NOT EXISTS taken_by TEXT;`,
    ],
    [
      '009_drop_supabase_realtime_publication',
      `DROP PUBLICATION IF EXISTS supabase_realtime;`,
    ],
    [
      '010_inventory_webhook_outbox',
      `CREATE TABLE IF NOT EXISTS public.inventory_webhook_outbox (
         id              uuid        DEFAULT gen_random_uuid() NOT NULL,
         event_type      text        NOT NULL,
         payload         jsonb       NOT NULL,
         status          text        DEFAULT 'pending' NOT NULL,
         attempts        integer     DEFAULT 0 NOT NULL,
         last_error      text,
         last_attempt_at timestamptz,
         delivered_at    timestamptz,
         created_at      timestamptz DEFAULT now() NOT NULL,
         CONSTRAINT inventory_webhook_outbox_pkey PRIMARY KEY (id),
         CONSTRAINT inventory_webhook_outbox_event_type_check
           CHECK (event_type IN ('pos-kot', 'pos-cancel')),
         CONSTRAINT inventory_webhook_outbox_status_check
           CHECK (status IN ('pending', 'delivered', 'failed'))
       );
       CREATE INDEX IF NOT EXISTS idx_inventory_webhook_outbox_pending
         ON public.inventory_webhook_outbox (created_at) WHERE status = 'pending';`,
    ],
  ]

  try {
    const { default: postgres } = await import('postgres')
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    for (const [key, ddl] of migrations) {
      const [existing] = await sql`
        SELECT filename FROM schema_migrations WHERE filename = ${key}
      `
      if (existing) continue

      await sql.unsafe(ddl)
      await sql`INSERT INTO schema_migrations (filename) VALUES (${key})`
      console.log(`[migrations] applied ${key}`)
    }

    await sql.end()
  } catch (err) {
    console.error('[migrations] failed:', err)
  }
}
