-- Leftover from when this schema was originally dumped off a Supabase project.
-- Nothing in the app subscribes to logical replication - no supabase-js client
-- exists in the codebase anymore (DB access is via `postgres` directly). Safe,
-- idempotent no-op if it was never created (e.g. a DB built from the already
-- cleaned-up docker/schema.sql).
DROP PUBLICATION IF EXISTS supabase_realtime;
