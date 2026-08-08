-- ============================================================
-- M10: Role-Based Access Control (Admin / Manager / Staff)
-- Replaces the two flat credentials (dashboard + menu_crud)
-- with a proper user table with role column.
-- ============================================================

-- 1. Add new columns ─────────────────────────────────────────
ALTER TABLE auth_credentials
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'manager'
    CHECK (role IN ('admin', 'manager', 'staff')),
  ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';

-- 2. Drop the scope UNIQUE constraint and column ─────────────
ALTER TABLE auth_credentials
  DROP CONSTRAINT IF EXISTS auth_credentials_scope_key;

ALTER TABLE auth_credentials
  DROP CONSTRAINT IF EXISTS auth_credentials_scope_check;

ALTER TABLE auth_credentials
  DROP COLUMN IF EXISTS scope;

-- 3. UNIQUE on user_id ───────────────────────────────────────
ALTER TABLE auth_credentials
  DROP CONSTRAINT IF EXISTS auth_credentials_user_id_key;

ALTER TABLE auth_credentials
  ADD CONSTRAINT auth_credentials_user_id_key UNIQUE (user_id);

-- 4. Seed three role users (truncate first so migration is idempotent) ──
TRUNCATE auth_credentials;

-- Hashes generated with bcryptjs (cost 10).
-- admin123  → admin
-- manager123 → manager
-- staff123  → staff
INSERT INTO auth_credentials (user_id, password_hash, role, display_name) VALUES
  ('admin',   '$2b$10$H0E/iF000LPkWp/RseBDZO9hEEWHDdXsG7I8WKLYquuJfioC6agi6', 'admin',   'Administrator'),
  ('manager', '$2b$10$CrQi97zTbx0yWOjhsBPCIe1Zk6y3LyLME6G2xpG0JdFwCIrSikfiq', 'manager', 'Manager'),
  ('staff',   '$2b$10$UIaybUC3jrTD6u2Ntx9ejOBy6S4cVi/O58uuxVw0qa.svKJCEggw6', 'staff',   'Staff');

-- 5. Staff notifications table ───────────────────────────────
CREATE TABLE IF NOT EXISTS staff_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id     UUID        NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL,
  description TEXT        NOT NULL,
  created_by  TEXT        NOT NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_notifications_cafe_created
  ON staff_notifications (cafe_id, created_at DESC);
