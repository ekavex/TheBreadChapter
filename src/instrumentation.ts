// Runs once on server startup (Next.js 14 instrumentation hook).
// Applies any pending SQL migrations from supabase/migrations/ in filename order.
// Uses a schema_migrations table to track what has already run — safe to re-deploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { default: postgres } = await import('postgres')
    const { readdir, readFile } = await import('fs/promises')
    const { join } = await import('path')

    const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

    // Create tracking table if it doesn't exist yet
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
    const files = (await readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const filename of files) {
      const [existing] = await sql`
        SELECT filename FROM schema_migrations WHERE filename = ${filename}
      `
      if (existing) continue

      const sqlText = await readFile(join(migrationsDir, filename), 'utf8')
      await sql.unsafe(sqlText)
      await sql`INSERT INTO schema_migrations (filename) VALUES (${filename})`
      console.log(`[migrations] applied ${filename}`)
    }

    await sql.end()
  } catch (err) {
    console.error('[migrations] failed:', err)
    // Do not crash the server — a failed migration should surface as an error
    // in the app, not prevent startup entirely.
  }
}
