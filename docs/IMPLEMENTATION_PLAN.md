# Smart Cafe Inventory, Recipe Costing & Analytics Management System
## Implementation Plan — built on `phase1`

**Sources of truth (in priority order):** `docs/DEVELOPER_HANDOVER_MASTER.md` → `docs/PINELABS_INTEGRATION_MASTER.md` → `docs/Smart_Cafe_SRS (2).docx` (Modules 1–11). This plan translates those three into concrete work against the actual `phase1` codebase.

**Codebase decision:** build on `phase1`, not `Phase2`. `Phase2` is a fully-built multi-tenant white-label SaaS (Supabase Auth + RLS, WhatsApp, loyalty, campaigns, admin onboarding, Vercel/Coolify deploy automation) — all of which the handover explicitly puts out of scope. `phase1` is a lean single-tenant skeleton with no auth and no excluded features, so the SRS's flat two-credential model and single-cafe scope drop in without fighting existing architecture. See the earlier discussion in this conversation for the full comparison.

**Order-entry decision (carried forward):** the existing customer-facing QR self-order flow in `phase1` (`/menu/[tableId]`, cart, order tracker) is left in place but not extended. The waiter POS described in Module 5 is new, separate work and becomes this project's order-entry surface.

---

## 1. What exists in `phase1` today

| Layer | What's there |
|---|---|
| Stack | Next.js 14 (App Router), TypeScript, Tailwind, Zustand (cart), `@supabase/supabase-js` + `@supabase/ssr` |
| DB | Supabase Postgres, one migration: `supabase/migrations/001_initial_schema.sql`. Raw SQL, no ORM. |
| Auth | **None.** No `middleware.ts`, no login/signup page, no session handling anywhere in the repo. |
| Multi-tenancy | Schema has `cafe_id` on every table (comment: "multi-tenant ready") but nothing in the app reads it dynamically — it's a single hardcoded demo cafe ("Sunrise Cafe") throughout. |
| Data model | `cafes`, `tables` (flat, no section), `menu_categories`, `menu_items` (veg/vegan/jain/spice/prep-time, no cost or food/beverage category), `customers` (present but unused — no capture flow wired), `orders` (status enum pending→confirmed→making→ready→served→cancelled→completed, Razorpay fields, tax/service-charge/discount), `order_items` (name/price snapshot, per-item status) |
| Order entry | Customer scans QR → `/menu/[tableId]` → builds cart → `POST /api/orders` creates the order directly as `pending`. **No waiter, no table-select flow, no KOT, no bill step, no terminal payment** — this is self-checkout, not POS. |
| Payment | Razorpay dependency present in `package.json`; not wired into a working checkout code path I found reading `phase1` (Phase2 is where Razorpay was actually built out). |
| Kitchen | `/kitchen` — Kanban board reading `order_items.status`, via `useKitchenOrders` (polling/Realtime hook) |
| Dashboard | `/dashboard` — overview, orders list, menu-manager (category/item CRUD, availability toggle), analytics (basic). All **ungated** — anyone who knows the URL can open it. |
| Realtime | Supabase Realtime publication on `orders`, `order_items` |
| API routes | `/api/menu` (GET list + PATCH availability), `/api/orders` (POST create, PATCH status, GET by date), `/api/tables` (GET list, POST generate QR) |

---

## 2. Gap analysis — SRS module → phase1 → what's missing

| # | Module | In `phase1` today | Missing |
|---|---|---|---|
| 1 | Inventory Management | Nothing | Ingredients table, stock quantity, purchase/adjustment/expired-removal entries, low-stock alerts, expiry tracking |
| 2 | Recipe Management | Nothing | Recipe per menu item, recipe-ingredient lines, automatic stock deduction on order completion |
| 3 | Dynamic Cost Management | `menu_items.price` (selling price) only | Ingredient `cost_per_unit`, recipe cost = Σ(qty × cost), auto-recalculation on cost change, profit = selling price − recipe cost |
| 4 | Sales Management | `orders`/`order_items` capture item/qty/date/time/table | No `section`/area on the table, no `customer_type`, no persisted "category" (food/beverage) on the sale line |
| 5 | Order, KOT Routing & Payment | Customer self-order only (no waiter step, no sections, no KOT, no bill, no terminal payment) | **Everything**: sections, live table status, waiter order-entry UI, category-based KOT split, `PrinterService`, bill generation/print, `PaymentProvider` + Pine Labs, order/payment state machine |
| 6 | Profit & Loss Analysis | Nothing (no cost data exists to net against revenue) | Daily/weekly/monthly/yearly P&L calc |
| 7 | Cafe Area Analytics | Nothing (`tables` has no section) | Section model, visitor/popular-item-by-area rollups, peak-hour heatmap |
| 8 | Customer Analytics | `customers` table exists but nothing writes to it in `phase1` | New/repeat/most-ordered/avg-bill/spend-trend queries; **and a decision on how identity is captured in a waiter-driven flow** (see Open Items) |
| 9 | Auth & Security | None | Two-credential model (`dashboard` scope, `menu_crud` scope), no roles, bcrypt hashing, session cookie, middleware gate |
| 10 | Dashboard | Today's orders/revenue, top items (basic) | Today's profit, low-stock items, most-visited area, peak hour, inventory value, live table statuses |
| 11 | Reports | Nothing | Daily/weekly/monthly reports; PDF/Excel/CSV/print export |

---

## 3. Data model additions

Continuing `phase1`'s existing convention: **raw SQL migrations + `@supabase/supabase-js`**, not introducing Prisma. (Phase2 uses Prisma and it's a nicer DX, but adopting it here is a framework change the handover says to flag first — listed as an open question below rather than assumed.)

New tables carry **no `cafe_id`** — per the single-cafe simplification, they implicitly scope to whichever one cafe row this instance runs for. Existing tables (`tables`, `menu_items`, `orders`, etc.) keep their `cafe_id` untouched.

```sql
-- Sections & tables (extends existing `tables`)
CREATE TYPE table_status AS ENUM ('free', 'occupied', 'kot_sent', 'billed');
CREATE TABLE sections (
  id INT PRIMARY KEY, name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE tables
  ADD COLUMN section_id INT REFERENCES sections(id),
  ADD COLUMN status table_status NOT NULL DEFAULT 'free';

-- Pine Labs terminals
CREATE TABLE terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT NOT NULL,       -- Pine Labs ClientId
  label TEXT NOT NULL,
  section_id INT REFERENCES sections(id)
);

-- Inventory
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,                    -- 'gm' | 'ml' | 'pieces' | 'liters' | 'kg'
  current_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 0,
  cost_per_unit_paisa BIGINT NOT NULL DEFAULT 0,
  is_perishable BOOLEAN NOT NULL DEFAULT false,
  expiry_date DATE,                      -- nearest-batch expiry; see Open Items re: batch tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE stock_txn_type AS ENUM ('purchase', 'sale_deduction', 'manual_adjustment', 'expired_removal');
CREATE TABLE stock_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  type stock_txn_type NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,        -- signed: + for purchase, - for deduction
  reference_order_id UUID REFERENCES orders(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recipes & costing
CREATE TYPE menu_item_category AS ENUM ('food', 'beverage');
ALTER TABLE menu_items
  ADD COLUMN category menu_item_category NOT NULL DEFAULT 'food',
  ADD COLUMN cost_price_paisa BIGINT NOT NULL DEFAULT 0;   -- cached, recomputed — see below

CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id UUID NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE
);
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC(12,3) NOT NULL
);

-- Order lifecycle additions (Module 5 state machine)
ALTER TABLE orders
  ADD COLUMN pos_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (pos_status IN ('OPEN','KOT_SENT','BILLED','AWAITING_PAYMENT','PAID','PAYMENT_FAILED','CANCELLED')),
  ADD COLUMN total_paisa BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN kot_sent_at TIMESTAMPTZ,
  ADD COLUMN billed_at TIMESTAMPTZ;
ALTER TABLE order_items
  ADD COLUMN category menu_item_category;   -- copied at order time for routing/reporting

CREATE TABLE kot_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  station TEXT NOT NULL CHECK (station IN ('kitchen','beverage_counter')),
  items_json JSONB NOT NULL,
  printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  print_status TEXT NOT NULL DEFAULT 'mock_printed'
);

-- Payments (Pine Labs)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  transaction_number TEXT NOT NULL UNIQUE,
  plutus_ptrid TEXT,
  status TEXT NOT NULL DEFAULT 'initiated', -- initiated|approved|declined|cancelled
  mode TEXT,                                -- CARD | UPI SALE | CASH
  amount_paisa BIGINT NOT NULL,
  rrn TEXT,
  approval_code TEXT,
  txn_log_id TEXT,
  client_id TEXT,
  store_id TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_ptrid ON payments(plutus_ptrid);
CREATE INDEX idx_payments_txn_number ON payments(transaction_number);

-- Auth (two flat credentials, no roles)
CREATE TABLE auth_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL UNIQUE CHECK (scope IN ('dashboard','menu_crud')),
  user_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Recipe cost / profit — computed, not stored-and-trusted:** `recipes` has no cost column. Recipe cost and item profit are computed on read (`Σ recipe_ingredients.quantity × ingredients.cost_per_unit_paisa`). `menu_items.cost_price_paisa` is a cache refreshed by the same function whenever an ingredient's cost changes or a recipe changes — never hand-edited.

**Money:** every new money column is `..._paisa BIGINT`, matching the handover's non-negotiable. Existing `NUMERIC` rupee columns in `orders`/`menu_items` stay as-is (not worth a breaking migration); new code converts once at the boundary.

---

## 4. Auth design (Module 9)

Fully decoupled from Supabase Auth — a small, self-contained system per the handover's flat model:

- `auth_credentials` seeded with exactly two rows (`scope='dashboard'`, `scope='menu_crud'`), bcrypt-hashed passwords.
- New `middleware.ts` (phase1 has none today) gates `/dashboard/**` and `/pos/**`: no valid session cookie → redirect to `/login`.
- `/login` — single form, checks against `scope='dashboard'`, sets an HttpOnly session cookie on success.
- Menu Add/Edit/Delete actions in `menu-manager` open a popup that re-verifies against `scope='menu_crud'` **per action**, not a session flag — matches "no roles, re-verify every time."
- No signup, no invite flow, no per-user accounts — exactly two credential pairs, changeable only by whoever can edit the DB row (matches "no roles" — there's no admin UI to manage other users because there are no other users).

---

## 5. Payment abstraction (Module 5 + Pine Labs)

Interface is fully specified in `PINELABS_INTEGRATION_MASTER.md` §10 — implemented verbatim:

```ts
interface PaymentProvider {
  charge(input: { transactionNumber: string; amountPaisa: number; allowedModes: string; clientId: string; storeId: string; userId?: string }): Promise<PaymentResult>
  status(ptrid: string, ctx: { clientId: string; storeId: string }): Promise<PaymentResult>
  cancel(ptrid: string, amountPaisa: number, ctx: { clientId: string; storeId: string }): Promise<PaymentResult>
}
```

- `MockPaymentProvider` — returns `approved` immediately (configurable delay/decline for testing the failure path). Used for every milestone until UAT creds exist.
- `PineLabsCloudProvider` — implements the same interface against `UploadBilledTransaction` / `GetStatus` / `CancelTransactionForced`, added in M6 once credentials/endpoints are confirmed (open item).
- Business logic (order finalization, stock deduction, dashboard push) calls only the interface — swapping providers is a one-line change.

## 6. Printer abstraction (KOT)

```ts
interface PrinterService {
  printTicket(station: 'kitchen' | 'beverage_counter', ticket: { tableNumber: number; items: { name: string; quantity: number }[] }): Promise<void>
}
```

`MockPrinterService` logs the ticket (and stores a row in `kot_tickets`) instead of talking to real hardware. Real network/BT printer client is a later swap once printer models/connectivity are confirmed with the client (open item).

---

## 7. API surface (new routes, grouped by module)

| Module | Routes |
|---|---|
| Auth (9) | `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/verify-menu-credentials` |
| Inventory (1) | `GET/POST /api/ingredients`, `PATCH/DELETE /api/ingredients/[id]`, `POST /api/ingredients/[id]/stock` (purchase / manual_adjustment / expired_removal), `GET /api/ingredients/low-stock`, `GET /api/ingredients/expiring` |
| Recipes & costing (2, 3) | `GET/POST /api/recipes`, `PATCH/DELETE /api/recipes/[id]` (menu-CRUD gated) |
| Menu (extends existing) | Existing `/api/menu` extended with `category`, computed `cost_price`/`profit`; mutations gated by menu-CRUD popup |
| Sections & tables (5, 7) | `GET/POST /api/sections`, `GET /api/tables` (extended with `section_id`, `status`), `PATCH /api/tables/[id]/status` |
| POS orders (5) | `POST /api/pos/orders` (open order for table), `PATCH /api/pos/orders/[id]/items` (add/update/remove), `POST /api/pos/orders/[id]/kot` (confirm → split → print → `KOT_SENT`), `GET /api/pos/orders/[id]/bill` (→ `BILLED`), `POST /api/pos/orders/[id]/pay` (→ Pine Labs charge → `AWAITING_PAYMENT`) |
| Payment webhook (Pine Labs) | `POST /webhooks/pinelabs` (urlencoded CSV → re-verify via `status()` → finalize) |
| Sales (4) | `GET /api/sales?from=&to=&section=&item=` |
| P&L (6) | `GET /api/analytics/profit-loss?range=daily\|weekly\|monthly\|yearly` |
| Area analytics (7) | `GET /api/analytics/area` (visitors + popular items by section, peak-hour heatmap) |
| Customer analytics (8) | `GET /api/analytics/customers` (pending the identity-capture decision — see Open Items) |
| Dashboard (10) | `GET /api/dashboard` (today's sales/profit, low-stock items, top seller, most-visited area, peak hour, pending orders, inventory value, live table statuses) |
| Reports (11) | `GET /api/reports/[daily\|weekly\|monthly]?format=pdf\|excel\|csv` |

---

## 8. Build order (milestones — each independently runnable/testable)

Following `DEVELOPER_HANDOVER_MASTER.md` §13, mapped onto `phase1`:

1. **M0 — Foundations.** Migration for sections/terminals/ingredients/recipes/recipe_ingredients/stock_transactions/payments/auth_credentials/menu_items+orders extensions. Seed sections + demo tables + one terminal. Stand up `PaymentProvider`/`PrinterService` interfaces + mocks. Add `middleware.ts` + `/login` + `auth_credentials` seed. *Test: log into `/dashboard` with seeded creds; schema visible in Supabase Studio.*
2. **M1 — Inventory (Mod 1).** Ingredient CRUD page, stock-update actions (purchase/adjust/expired-removal), low-stock + expiry alerts. *Test: add an ingredient, log a purchase, cross the low-stock threshold, see the alert.*
3. **M2 — Recipes & costing (Mod 2, 3).** Recipe builder (menu item → ingredient lines + qty), cost/profit computed and shown on the menu-manager page. *Test: build the Cold Coffee recipe from the SRS example, confirm cost = ₹25, profit = ₹95 at ₹120 selling price; change milk's cost, confirm recipe cost updates.*
4. **M3 — Menu CRUD + auth hardening (Mod 4-menu, 9).** Add `category` (food/beverage) to menu items; gate Add/Edit/Delete behind the menu-CRUD popup; gate `/dashboard` behind the dashboard-access login. *Test: editing a menu item without the popup credential is blocked; dashboard is unreachable without login.*
5. **M4 — Order, KOT, bill (Mod 5, minus real payment).** Waiter POS screen (new `/pos` route): section → table → menu → order → confirm (KOT split via `MockPrinterService`, table → `kot_sent`) → bill (→ `billed`) → pay via `MockPaymentProvider` end-to-end (→ `paid`, stock deducted per recipe, table → `free`). *Test: run the SRS worked example (Table 4, 1 Croissant + 1 Iced Coffee) start to finish against mocks.*
6. **M5 — Dashboard + sales (Mod 4, 10).** Real-time tiles (today's sales/profit, low-stock, top seller, most-visited area, peak hour, pending orders, inventory value), live table-status grid. *Test: seeded orders across sections/times produce correct tile values.*
7. **M6 — Pine Labs (real).** `PineLabsCloudProvider` (Upload/GetStatus/Cancel), `/webhooks/pinelabs`, reconciliation poll for stuck `AWAITING_PAYMENT` orders. Runs in parallel with M1–M5 pending onboarding; swap mock → real behind the same interface. *Test: full UAT matrix from `PINELABS_INTEGRATION_MASTER.md` §14.*
8. **M7 — Analytics (Mod 6, 7, 8).** P&L (daily/weekly/monthly/yearly), area analytics + heatmap, customer analytics (pending Open Item below). *Test: numbers match a manual calc against seeded data.*
9. **M8 — Reports (Mod 11).** Daily/weekly/monthly report pages + PDF/Excel/CSV/print export.
10. **M9 — Hardening.** Idempotency tests on payment finalization, offline-payment behavior, observability/logging on every Pine Labs call and KOT print, production cutover checklist.

Each milestone ends with: what changed, how to run/test it, then stop for review before the next one — per your standing instructions.

---

## 9. Open questions / assumptions

Carried forward from `DEVELOPER_HANDOVER_MASTER.md` §14 plus a few specific to the `phase1` conversion:

1. **ORM choice.** Plan assumes continuing raw SQL migrations + `supabase-js` (phase1's current convention) rather than adopting Prisma (which Phase2 uses). Confirm, or say if you'd rather standardize on Prisma now.
2. **Area list mismatch (unresolved in the master doc itself).** SRS Module 7 lists 5 areas (Indoor, Outdoor, Smoking, Rooftop, Lounge); Module 5's worked example uses 3 sections (Indoor T1–10, Outdoor T11–18, Smoking T19–24). Plan seeds 3 sections to match the operational flow — confirm whether Rooftop/Lounge need to exist as real sections with tables, or were just illustrative in Module 7.
3. **Customer identity capture.** Module 8 wants new/repeat/most-ordered/avg-bill per customer, but Module 5's waiter flow never describes capturing a phone/name. Default assumption: an *optional* phone field the waiter can enter when opening a table's order (skippable for anonymous walk-ins); customer analytics only covers orders where it was captured. Confirm this is acceptable, or whether identity capture should be mandatory some other way.
4. **Expiry tracking granularity.** Plan uses one `expiry_date` per ingredient (nearest upcoming batch), not full FIFO batch tracking. Confirm this is enough, or if purchase-batch-level expiry tracking is required.
5. **Expense module.** Explicitly removed from scope per the handover, but Module 6's P&L example subtracts "Other Expenses" from profit. Plan computes P&L as `revenue − ingredient cost` only (no expense line) unless you want a minimal `expenses` table reinstated just for the P&L subtraction.
6. **Pine Labs specifics (blocking M6 only, not M0–M5):** exact Upload/GetStatus endpoint paths + production host, final `MerchantID`/`SecurityToken`/`StoreId`/`ClientId` per terminal, which payment modes are enabled, Post Back URL webhook format/auth for this account, number of A910S terminals in the cafe.
7. **KOT printer hardware.** Model/connectivity (network vs Bluetooth) for the kitchen and beverage-counter printers — needed before `PrinterService`'s real implementation, not before the mock.
8. **Offline behavior.** What should happen to order-taking/payment if the network drops mid-flow — not specified in the SRS or handover; needs a decision before M9.

---

## 10. Non-negotiables carried through every milestone

- Backend is the single source of truth; no client (waiter app, dashboard, printers, terminal) holds authoritative state.
- Money in **paisa**, integers, converted once at the boundary.
- Every stock/money operation is **idempotent** — a retried webhook or poll must not double-deduct or double-charge.
- Pine Labs secrets (`MerchantID`/`SecurityToken`) never leave the backend.
- Payment and printing stay behind their interfaces — mocks first, real implementations swap in with zero business-logic change.

---

**Stop here for review**, per Phase 1 instructions — no feature code until this plan is approved.
