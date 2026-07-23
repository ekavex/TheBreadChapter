-- ============================================================
-- CAFE SYSTEM — Phase 1 Database Schema
-- Run this in Supabase SQL Editor or via: supabase db push
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── CAFES ──────────────────────────────────────────────────
-- One row per cafe client. Multi-tenant ready.
CREATE TABLE cafes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,          -- used in URL: /menu/[slug]/[table]
  logo_url      TEXT,
  address       TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  currency      TEXT NOT NULL DEFAULT 'INR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  settings      JSONB NOT NULL DEFAULT '{
    "accept_cash": true,
    "accept_upi": true,
    "accept_card": false,
    "tax_percent": 5,
    "service_charge_percent": 0,
    "show_social_proof": true,
    "languages": ["en", "hi"]
  }'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLES ─────────────────────────────────────────────────
CREATE TABLE tables (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id       UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  number        INT  NOT NULL,
  label         TEXT,                           -- e.g. "Window Seat", "Rooftop 3"
  capacity      INT  NOT NULL DEFAULT 4,
  qr_code_url   TEXT,                           -- stored in Supabase Storage
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cafe_id, number)
);

-- ─── MENU CATEGORIES ────────────────────────────────────────
CREATE TABLE menu_categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id       UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_hi       TEXT,                           -- Hindi translation
  description   TEXT,
  image_url     TEXT,
  sort_order    INT  NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MENU ITEMS ─────────────────────────────────────────────
CREATE TABLE menu_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id         UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_hi         TEXT,
  description     TEXT,
  description_hi  TEXT,
  price           NUMERIC(10,2) NOT NULL,
  image_url       TEXT,
  is_veg          BOOLEAN NOT NULL DEFAULT true,
  is_vegan        BOOLEAN NOT NULL DEFAULT false,
  is_jain         BOOLEAN NOT NULL DEFAULT false,
  contains_gluten BOOLEAN NOT NULL DEFAULT true,
  contains_nuts   BOOLEAN NOT NULL DEFAULT false,
  spice_level     INT CHECK (spice_level BETWEEN 0 AND 3) DEFAULT 0,
  is_available    BOOLEAN NOT NULL DEFAULT true,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  sort_order      INT  NOT NULL DEFAULT 0,
  order_count     INT  NOT NULL DEFAULT 0,     -- for social proof "Ordered X times"
  prep_time_mins  INT  NOT NULL DEFAULT 10,
  -- Upsell: pair this item with another
  upsell_item_ids UUID[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CUSTOMERS ──────────────────────────────────────────────
-- Auto-created from WhatsApp number on first order (Phase 2+)
-- Phase 1: optional, can be anonymous
CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id       UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  phone         TEXT NOT NULL,
  name          TEXT,
  whatsapp      TEXT,
  total_orders  INT  NOT NULL DEFAULT 0,
  total_spent   NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_visit_at TIMESTAMPTZ,
  tags          TEXT[] DEFAULT '{}',           -- 'vip', 'regular', 'lapsed'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cafe_id, phone)
);

-- ─── ORDERS ─────────────────────────────────────────────────
CREATE TYPE order_status AS ENUM (
  'pending',    -- just placed, not yet confirmed
  'confirmed',  -- accepted by kitchen
  'making',     -- being prepared
  'ready',      -- ready to serve
  'served',     -- delivered to table
  'cancelled',  -- cancelled
  'completed'   -- paid and done
);

CREATE TYPE payment_method AS ENUM ('upi', 'card', 'cash', 'unpaid');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id         UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  table_id        UUID NOT NULL REFERENCES tables(id),
  customer_id     UUID REFERENCES customers(id),
  order_number    TEXT NOT NULL,               -- human-readable: "ORD-0042"
  status          order_status NOT NULL DEFAULT 'pending',
  payment_method  payment_method NOT NULL DEFAULT 'unpaid',
  payment_status  payment_status NOT NULL DEFAULT 'pending',
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,                         -- customer's special instructions
  estimated_mins  INT,
  confirmed_at    TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  served_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-increment order number per cafe
CREATE SEQUENCE order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number(cafe_id UUID)
RETURNS TEXT AS $$
DECLARE
  seq_val INT;
BEGIN
  seq_val := nextval('order_number_seq');
  RETURN 'ORD-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ─── ORDER ITEMS ────────────────────────────────────────────
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
  name            TEXT NOT NULL,               -- snapshot at time of order
  price           NUMERIC(10,2) NOT NULL,      -- snapshot at time of order
  quantity        INT  NOT NULL DEFAULT 1,
  customisation   TEXT,                        -- "no sugar", "extra shot"
  subtotal        NUMERIC(10,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- for per-item kitchen tracking
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── REAL-TIME: enable row-level changes for kitchen display ─
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE cafes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Public can read menu and place orders (anon key)
CREATE POLICY "Public can read active menu items"
  ON menu_items FOR SELECT USING (is_available = true);

CREATE POLICY "Public can read menu categories"
  ON menu_categories FOR SELECT USING (is_active = true);

CREATE POLICY "Public can read cafe info"
  ON cafes FOR SELECT USING (is_active = true);

CREATE POLICY "Public can read tables"
  ON tables FOR SELECT USING (is_active = true);

CREATE POLICY "Public can create orders"
  ON orders FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can create order items"
  ON order_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can view their own order"
  ON orders FOR SELECT USING (true);

CREATE POLICY "Public can view order items"
  ON order_items FOR SELECT USING (true);

-- ─── TRIGGERS ───────────────────────────────────────────────
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Increment order_count on menu_items when ordered
CREATE OR REPLACE FUNCTION increment_order_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE menu_items
  SET order_count = order_count + NEW.quantity
  WHERE id = NEW.menu_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_item_increment_count
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION increment_order_count();

-- ─── SUPABASE REALTIME ───────────────────────────────────────
-- Enable realtime for kitchen display and order tracking
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE orders, order_items;
COMMIT;

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX idx_orders_cafe_id      ON orders(cafe_id);
CREATE INDEX idx_orders_table_id     ON orders(table_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_created_at   ON orders(created_at DESC);
CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_menu_items_cafe     ON menu_items(cafe_id, category_id);
CREATE INDEX idx_menu_items_featured ON menu_items(cafe_id, is_featured);
