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
    [
      '011_bill_numbers',
      `
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_number text;

        CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_bill_number
            ON orders USING btree (cafe_id, bill_number)
            WHERE (bill_number IS NOT NULL);

        -- One row per cafe per financial year ("26-27"); last_value is the last
        -- sequence number handed out. Incremented inside the billing transaction.
        CREATE TABLE IF NOT EXISTS bill_number_counters (
            cafe_id        uuid    NOT NULL,
            financial_year text    NOT NULL,
            last_value     integer DEFAULT 0 NOT NULL,
            CONSTRAINT bill_number_counters_pkey PRIMARY KEY (cafe_id, financial_year),
            CONSTRAINT bill_number_counters_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
        );
      `,
    ],
    [
      '012_print_job_claimed_at',
      `ALTER TABLE kot_tickets ADD COLUMN IF NOT EXISTS claimed_at timestamptz;`,
    ],
    [
      '013_app_logs',
      `
        CREATE TABLE IF NOT EXISTS app_logs (
            id          bigint GENERATED ALWAYS AS IDENTITY,
            logged_at   timestamp with time zone NOT NULL,
            received_at timestamp with time zone DEFAULT now() NOT NULL,
            source      text NOT NULL,
            level       text NOT NULL,
            event       text NOT NULL,
            message     text,
            order_id    uuid,
            device_id   text,
            app_version text,
            request_id  text,
            data        jsonb,
            CONSTRAINT app_logs_pkey PRIMARY KEY (id),
            CONSTRAINT app_logs_source_check CHECK (source = ANY (ARRAY['server'::text, 'device'::text, 'browser'::text])),
            CONSTRAINT app_logs_level_check CHECK (level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text]))
        );

        CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at ON app_logs USING btree (logged_at DESC);
        CREATE INDEX IF NOT EXISTS idx_app_logs_received_at ON app_logs USING btree (received_at);
        CREATE INDEX IF NOT EXISTS idx_app_logs_problems ON app_logs USING btree (logged_at DESC)
            WHERE (level = ANY (ARRAY['warn'::text, 'error'::text]));
        CREATE INDEX IF NOT EXISTS idx_app_logs_order ON app_logs USING btree (order_id, logged_at)
            WHERE (order_id IS NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_app_logs_device ON app_logs USING btree (device_id, logged_at DESC)
            WHERE (device_id IS NOT NULL);

        -- Developer-friendly view: cafe-local time and the order number.
        CREATE OR REPLACE VIEW app_logs_view AS
        SELECT
            (l.logged_at AT TIME ZONE 'Asia/Kolkata') AS ist_time,
            l.source,
            l.level,
            l.event,
            l.message,
            o.order_number,
            l.device_id,
            l.app_version,
            l.request_id,
            l.data,
            l.order_id,
            l.id
        FROM app_logs l
        LEFT JOIN orders o ON o.id = l.order_id;
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
