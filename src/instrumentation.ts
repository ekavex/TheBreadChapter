// Runs once on server startup - requires experimental.instrumentationHook in
// next.config.js on Next.js 14 (stable-by-default from Next.js 15 on).
// Delegates to src/lib/migrations.ts so the Node-only `postgres` import
// never gets pulled into the Edge runtime bundle - see that file for why.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { runMigrations } = await import('./lib/migrations')
  await runMigrations()
}
