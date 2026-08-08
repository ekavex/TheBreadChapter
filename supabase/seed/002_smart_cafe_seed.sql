-- ============================================================
-- SEED: Smart Cafe foundations (sections, tables, terminal, auth)
-- Run after 001_initial_schema.sql + demo_cafe.sql + 002_smart_cafe_foundations.sql
-- ============================================================

-- Sections (Module 5 worked example: Indoor T1-10, Outdoor T11-18, Smoking T19-24.
-- Demo data below reuses the existing 6 demo tables + adds 2 more so all 3
-- sections have at least one table for area-analytics testing.
-- NOTE: SRS Module 7 also lists Rooftop/Lounge — open item, see IMPLEMENTATION_PLAN.md #2.)
INSERT INTO sections (id, name, sort_order) VALUES
  (1, 'Indoor', 1),
  (2, 'Outdoor', 2),
  (3, 'Smoking', 3);

-- Assign existing demo tables (from demo_cafe.sql) to sections
UPDATE tables SET section_id = 1 WHERE cafe_id = '11111111-1111-1111-1111-111111111111' AND number IN (1, 2, 3, 6); -- Entrance, Window Seat, Corner Booth, Bar Counter
UPDATE tables SET section_id = 2 WHERE cafe_id = '11111111-1111-1111-1111-111111111111' AND number IN (4, 5);      -- Outdoor, Rooftop

-- Two extra tables for the Smoking section (none existed in the original demo set)
INSERT INTO tables (cafe_id, number, label, capacity, section_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 7, 'Smoking 1', 2, 3),
  ('11111111-1111-1111-1111-111111111111', 8, 'Smoking 2', 2, 3);

-- One Pine Labs A910S terminal (UAT placeholder — real ClientId comes from onboarding)
INSERT INTO terminals (client_id, label, section_id) VALUES
  ('UAT-TERMINAL-1', 'Front Counter A910S', 1);

-- Three role-based credentials (M10 RBAC). CHANGE THESE PASSWORDS before any real use.
-- admin   → password: admin123
-- manager → password: manager123
-- staff   → password: staff123
INSERT INTO auth_credentials (user_id, password_hash, role, display_name) VALUES
  ('admin',   '$2b$10$H0E/iF000LPkWp/RseBDZO9hEEWHDdXsG7I8WKLYquuJfioC6agi6', 'admin',   'Administrator'),
  ('manager', '$2b$10$CrQi97zTbx0yWOjhsBPCIe1Zk6y3LyLME6G2xpG0JdFwCIrSikfiq', 'manager', 'Manager'),
  ('staff',   '$2b$10$UIaybUC3jrTD6u2Ntx9ejOBy6S4cVi/O58uuxVw0qa.svKJCEggw6', 'staff',   'Staff')
ON CONFLICT (user_id) DO NOTHING;

-- Sample ingredients + recipes so M1/M2 have something to show immediately.
-- Milk seeded at 5 paisa/ml (= ₹50/L) to match the SRS's Module 3 "before" cost example.
INSERT INTO ingredients (id, name, unit, current_stock, low_stock_threshold, cost_per_unit_paisa, is_perishable, expiry_date) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Milk',          'ml',     20000, 3000,  5, true,  CURRENT_DATE + INTERVAL '4 days'),
  ('a0000002-0000-0000-0000-000000000002', 'Coffee Powder', 'gm',      5000,  500, 12, false, NULL),
  ('a0000003-0000-0000-0000-000000000003', 'Sugar',         'gm',      8000,  500,  6, false, NULL),
  ('a0000004-0000-0000-0000-000000000004', 'Bread',         'pieces',   200,   20, 300, true,  CURRENT_DATE + INTERVAL '2 days'),
  ('a0000005-0000-0000-0000-000000000005', 'Butter',        'gm',      3000,  300, 80, true,  CURRENT_DATE + INTERVAL '10 days'),
  ('a0000006-0000-0000-0000-000000000006', 'Vegetables',    'gm',      6000,  500, 20, true,  CURRENT_DATE + INTERVAL '3 days');

-- Cold Coffee recipe (SRS worked example: Milk 200ml + Coffee 10gm + Sugar 15gm)

INSERT INTO recipes (id, menu_item_id)
SELECT 'b0000001-0000-0000-0000-000000000001', id FROM menu_items WHERE name = 'Cold Brew' LIMIT 1;

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 200), -- 200ml milk
  ('b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000002', 10),  -- 10gm coffee
  ('b0000001-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000003', 15);  -- 15gm sugar

-- Veg Sandwich style recipe on Chocolate Croissant (closest existing "food" demo item)
UPDATE menu_items SET category = 'food' WHERE name IN ('Chocolate Croissant', 'Vada Pav', 'Cheese Toast', 'English Breakfast', 'Poha', 'Chocolate Brownie', 'Gulab Jamun');
UPDATE menu_items SET category = 'beverage' WHERE category = 'food' AND name NOT IN ('Chocolate Croissant', 'Vada Pav', 'Cheese Toast', 'English Breakfast', 'Poha', 'Chocolate Brownie', 'Gulab Jamun');

INSERT INTO recipes (id, menu_item_id)
SELECT 'b0000002-0000-0000-0000-000000000002', id FROM menu_items WHERE name = 'Chocolate Croissant' LIMIT 1;

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES
  ('b0000002-0000-0000-0000-000000000002', 'a0000004-0000-0000-0000-000000000004', 2),  -- 2 pieces bread (stand-in for croissant base)
  ('b0000002-0000-0000-0000-000000000002', 'a0000005-0000-0000-0000-000000000005', 10); -- 10gm butter
