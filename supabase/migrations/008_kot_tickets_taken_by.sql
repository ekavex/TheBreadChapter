-- kot_tickets.taken_by is written by /api/pos/orders/[id]/kot and read back by
-- /api/pos/print-jobs, but was never captured in a migration or docker/schema.sql —
-- same class of drift as the menu_items.variants issue. Idempotent add.
ALTER TABLE kot_tickets ADD COLUMN IF NOT EXISTS taken_by TEXT;
