-- ============================================================
-- SMART CAFE - M9 Hardening
-- Exactly-once stock deduction on payment finalization. Two concurrent
-- requests can both reach the finalize step for the same approved payment
-- (e.g. a fresh-charge response racing a reconciliation poll of the same
-- ptrid) - a SELECT-then-INSERT "already deducted?" check is racy under
-- that concurrency. This column is claimed with a single atomic
-- `UPDATE ... WHERE stock_deducted_at IS NULL`, which Postgres serializes
-- at the row level, so only one concurrent request ever wins it.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN stock_deducted_at TIMESTAMPTZ;
