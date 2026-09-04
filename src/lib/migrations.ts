// Applied once on server startup - see src/instrumentation.ts. Migrations
// are embedded inline - no file-path dependency inside Docker.
//
// This file must only ever be reached via a dynamic import from a Node-only
// code path. Even a top-level `await import('postgres')` inside
// instrumentation.ts itself still gets statically traced into the Edge
// runtime bundle by Next's compiler (which has no `net` module and fails to
// build) - the file boundary is what stops that, not the runtime check
// alone.
export async function runMigrations(): Promise<void> {
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
      '010_print_reliability_and_logging',
      `
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_kot_ticket
            ON kot_tickets USING btree (order_id, station, job_type)
            WHERE (print_status = ANY (ARRAY['queued'::text, 'processing'::text]));

        CREATE TABLE IF NOT EXISTS print_log (
            id            uuid        DEFAULT uuid_generate_v4() NOT NULL,
            kot_ticket_id uuid,
            order_id      uuid        NOT NULL,
            station       text        NOT NULL,
            job_type      text        NOT NULL,
            event         text        NOT NULL,
            detail        text,
            actor         text,
            created_at    timestamptz DEFAULT now() NOT NULL,
            CONSTRAINT print_log_pkey PRIMARY KEY (id),
            CONSTRAINT print_log_event_check
                CHECK (event = ANY (ARRAY['queued'::text, 'printed'::text, 'stale_reclaimed'::text, 'skipped_duplicate'::text])),
            CONSTRAINT print_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_print_log_order_created ON print_log USING btree (order_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_print_log_created ON print_log USING btree (created_at DESC);
      `,
    ],
  ]

  try {
    // webpackIgnore: even nested behind two dynamic import() boundaries and
    // a NEXT_RUNTIME==='nodejs' guard, Next 14's edge/middleware compiler
    // still statically traces this specifier and fails to bundle it
    // ("Can't resolve 'net'") - this comment is what actually stops that;
    // the file-split alone (see instrumentation.ts) was not sufficient.
    const { default: postgres } = await import(/* webpackIgnore: true */ 'postgres')
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
