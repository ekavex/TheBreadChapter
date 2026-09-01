-- ============================================================
-- SMART CAFE - M0 Foundations
-- Sections, tables status, terminals, inventory, recipes, costing,
-- POS order lifecycle, KOT tickets, payments, auth credentials.
-- Run after 001_initial_schema.sql.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── SECTIONS & TABLE STATUS (Module 5, 7) ───────────────────
CREATE TABLE sections (
  id          INT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TYPE table_status AS ENUM ('free', 'occupied', 'kot_sent', 'billed');

ALTER TABLE tables
  ADD COLUMN section_id INT REFERENCES sections(id),
  ADD COLUMN status table_status NOT NULL DEFAULT 'free';

-- ─── PINE LABS TERMINALS (Module 5) ──────────────────────────
CREATE TABLE terminals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   TEXT NOT NULL,      -- Pine Labs ClientId
  label       TEXT NOT NULL,
  section_id  INT REFERENCES sections(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INVENTORY (Module 1) ─────────────────────────────────────
CREATE TABLE ingredients (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL UNIQUE,
  unit                  TEXT NOT NULL,               -- 'gm' | 'ml' | 'pieces' | 'liters' | 'kg'
  current_stock         NUMERIC(12,3) NOT NULL DEFAULT 0,
  low_stock_threshold   NUMERIC(12,3) NOT NULL DEFAULT 0,
  cost_per_unit_paisa   BIGINT NOT NULL DEFAULT 0,
  is_perishable         BOOLEAN NOT NULL DEFAULT false,
  expiry_date           DATE,                        -- nearest upcoming batch expiry
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER ingredients_updated_at
  BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TYPE stock_txn_type AS ENUM ('purchase', 'sale_deduction', 'manual_adjustment', 'expired_removal');

CREATE TABLE stock_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id       UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type                stock_txn_type NOT NULL,
  quantity            NUMERIC(12,3) NOT NULL,   -- signed: + for purchase, - for deduction/removal
  reference_order_id  UUID REFERENCES orders(id),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_transactions_ingredient ON stock_transactions(ingredient_id, created_at DESC);

-- Keep ingredients.current_stock as a running balance
CREATE OR REPLACE FUNCTION apply_stock_transaction()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ingredients
  SET current_stock = current_stock + NEW.quantity
  WHERE id = NEW.ingredient_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_transactions_apply
  AFTER INSERT ON stock_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_stock_transaction();

-- ─── MENU CATEGORY (food/beverage) + COST CACHE (Module 3, 5) ─
CREATE TYPE menu_item_category AS ENUM ('food', 'beverage');

ALTER TABLE menu_items
  ADD COLUMN category menu_item_category NOT NULL DEFAULT 'food',
  ADD COLUMN cost_price_paisa BIGINT NOT NULL DEFAULT 0;

-- ─── RECIPES (Module 2, 3) ────────────────────────────────────
CREATE TABLE recipes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id  UUID NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recipe_ingredients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id      UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id  UUID NOT NULL REFERENCES ingredients(id),
  quantity       NUMERIC(12,3) NOT NULL,
  UNIQUE(recipe_id, ingredient_id)
);

-- Recompute a single menu item's cached cost from its recipe
CREATE OR REPLACE FUNCTION recompute_menu_item_cost(p_menu_item_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_cost BIGINT;
BEGIN
  SELECT COALESCE(SUM(ri.quantity * i.cost_per_unit_paisa), 0)::BIGINT
  INTO v_cost
  FROM recipes r
  JOIN recipe_ingredients ri ON ri.recipe_id = r.id
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE r.menu_item_id = p_menu_item_id;

  UPDATE menu_items SET cost_price_paisa = v_cost WHERE id = p_menu_item_id;
  RETURN v_cost;
END;
$$ LANGUAGE plpgsql;

-- Recompute every menu item that uses a given ingredient (called when its cost changes)
CREATE OR REPLACE FUNCTION recompute_menu_items_for_ingredient(p_ingredient_id UUID)
RETURNS VOID AS $$
DECLARE
  v_menu_item_id UUID;
BEGIN
  FOR v_menu_item_id IN
    SELECT DISTINCT r.menu_item_id
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    WHERE ri.ingredient_id = p_ingredient_id
  LOOP
    PERFORM recompute_menu_item_cost(v_menu_item_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger: ingredient cost changes -> recompute all recipes using it
CREATE OR REPLACE FUNCTION on_ingredient_cost_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cost_per_unit_paisa IS DISTINCT FROM OLD.cost_per_unit_paisa THEN
    PERFORM recompute_menu_items_for_ingredient(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ingredients_cost_change
  AFTER UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION on_ingredient_cost_change();

-- Trigger: recipe_ingredients change -> recompute that one menu item
CREATE OR REPLACE FUNCTION on_recipe_ingredients_change()
RETURNS TRIGGER AS $$
DECLARE
  v_recipe_id UUID := COALESCE(NEW.recipe_id, OLD.recipe_id);
  v_menu_item_id UUID;
BEGIN
  SELECT menu_item_id INTO v_menu_item_id FROM recipes WHERE id = v_recipe_id;
  IF v_menu_item_id IS NOT NULL THEN
    PERFORM recompute_menu_item_cost(v_menu_item_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recipe_ingredients_change
  AFTER INSERT OR UPDATE OR DELETE ON recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION on_recipe_ingredients_change();

-- ─── ORDER LIFECYCLE ADDITIONS (Module 5) ─────────────────────
ALTER TABLE orders
  ADD COLUMN pos_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (pos_status IN ('OPEN','KOT_SENT','BILLED','AWAITING_PAYMENT','PAID','PAYMENT_FAILED','CANCELLED')),
  ADD COLUMN total_paisa BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN kot_sent_at TIMESTAMPTZ,
  ADD COLUMN billed_at TIMESTAMPTZ;

ALTER TABLE order_items
  ADD COLUMN category menu_item_category;   -- copied at order time for routing/reporting

CREATE TABLE kot_tickets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  station       TEXT NOT NULL CHECK (station IN ('kitchen','beverage_counter')),
  items_json    JSONB NOT NULL,
  printed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  print_status  TEXT NOT NULL DEFAULT 'mock_printed'
);

CREATE INDEX idx_kot_tickets_order ON kot_tickets(order_id);

-- ─── PAYMENTS (Pine Labs) ─────────────────────────────────────
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  transaction_number  TEXT NOT NULL UNIQUE,
  plutus_ptrid        TEXT,
  status              TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','approved','declined','cancelled')),
  mode                TEXT,                  -- CARD | UPI SALE | CASH
  amount_paisa        BIGINT NOT NULL,
  rrn                 TEXT,
  approval_code       TEXT,
  txn_log_id          TEXT,
  client_id           TEXT,
  store_id            TEXT,
  raw_response        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_ptrid ON payments(plutus_ptrid);
CREATE INDEX idx_payments_txn_number ON payments(transaction_number);
CREATE INDEX idx_payments_order ON payments(order_id);

-- ─── AUTH: two flat credentials, no roles (Module 9) ──────────
CREATE TABLE auth_credentials (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope          TEXT NOT NULL UNIQUE CHECK (scope IN ('dashboard','menu_crud')),
  user_id        TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: no `expenses` table. Per IMPLEMENTATION_PLAN.md open item #5 - Expense
-- Management is explicitly out of scope per DEVELOPER_HANDOVER_MASTER.md, so
-- P&L (Module 6, M7) computes as revenue - ingredient cost only for now.
-- Add this table + wire it into the P&L query if that decision changes.
