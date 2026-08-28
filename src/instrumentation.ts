// Runs once on server startup (Next.js 14 instrumentation hook).
// Migrations are embedded inline — no file-path dependency inside Docker.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Each entry: [filename_key, sql_to_run]
  // Add new migrations here in order. Never edit or remove existing entries.
  const migrations: [string, string][] = [
    [
      '007_menu_variants',
      `ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT NULL;`,
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
