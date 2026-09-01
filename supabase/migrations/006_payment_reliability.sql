-- ============================================================
-- Phase 1 - payment reliability hardening.
--
-- 1. REQUIRES_VERIFICATION order state (ambiguous payment; never auto-retry)
-- 2. One live order per table (removes the create-order race)
-- 3. At most one approved payment per order (defence in depth against
--    double-charge bookkeeping)
-- 4. payment_events - audit trail + webhook de-duplication
-- 5. Index supporting the reconciliation sweep
-- ============================================================

-- 1. New order state ─────────────────────────────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pos_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_pos_status_check CHECK (
    pos_status = ANY (ARRAY[
      'OPEN', 'KOT_SENT', 'BILLED', 'AWAITING_PAYMENT',
      'PAID', 'PAYMENT_FAILED', 'REQUIRES_VERIFICATION', 'CANCELLED'
    ])
  );

-- Timestamp of the last successful reconciliation attempt, so the sweep can
-- back off instead of hammering Pine Labs for a stuck order.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

-- 2. One live order per table ────────────────────────────────
-- Two waiters tapping the same table simultaneously previously created two
-- OPEN orders (read-then-insert race). The partial unique index makes the
-- second insert fail instead, and the route falls back to resuming.
-- Pre-flight: refuse to create the index silently if the data already
-- violates it, and name the offending tables so they can be cleaned up.
DO $$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(table_id::text, ', ')
    INTO offenders
    FROM (
      SELECT table_id
        FROM orders
       WHERE pos_status NOT IN ('PAID', 'CANCELLED')
       GROUP BY table_id
      HAVING count(*) > 1
    ) dupes;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce one live order per table - these tables have more than one live order: %. Close or cancel the duplicates, then re-run this migration.',
      offenders;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_order_per_table
  ON orders (table_id)
  WHERE pos_status NOT IN ('PAID', 'CANCELLED');

-- 3. One approved payment per order ──────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_approved_payment_per_order
  ON payments (order_id)
  WHERE status = 'approved';

-- 4. Payment event audit trail ───────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID        REFERENCES payments(id) ON DELETE SET NULL,
  order_id      UUID        REFERENCES orders(id)   ON DELETE SET NULL,
  source        TEXT        NOT NULL CHECK (source IN ('webhook', 'poll', 'reconciler', 'cancel')),
  ptrid         TEXT,
  dedupe_key    TEXT,
  reported      TEXT,
  verified      TEXT,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same postback delivered twice is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_event_dedupe
  ON payment_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_order_created
  ON payment_events (order_id, created_at DESC);

-- 5. Reconciliation sweep index ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_unsettled
  ON orders (pos_status, updated_at)
  WHERE pos_status IN ('AWAITING_PAYMENT', 'REQUIRES_VERIFICATION');
