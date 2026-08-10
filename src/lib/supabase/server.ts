// ─── Compatibility shim: supabase → postgres ─────────────────
// All API routes import createAdminClient() from here.
// Now returns the raw postgres Sql instance instead of the Supabase client.
// Routes have been updated to use tagged-template SQL instead of .from().select().
export { getDb as createAdminClient } from '@/lib/db'
