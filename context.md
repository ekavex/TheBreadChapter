# Context for: Detailed Inventory Management System

This is a handoff doc for building a **separate project** - a fully automated,
detailed inventory analytics system (down to the smallest unit: grams / ml /
pieces) - that will **connect to this existing POS** (The Bread Chapter) so
that placing an order automatically deducts raw materials from stock.

Give this whole file to whatever AI tool/agent builds that project.

---

## 1. What this POS project already is

Next.js 14 (App Router) + TypeScript strict + self-hosted PostgreSQL (via the
`postgres` npm client, raw SQL, no ORM). Single cafe per deployment - every
table carries `cafe_id`. Live in production; a waiter-operated POS + KOT +
billing + manager dashboard, plus an Android print-bridge APK
(Bluetooth thermal printers, ESC/POS) that this repo talks to over HTTP.

Roles: `admin` / `manager` / `staff`, session cookie-based (`sc_session`
httpOnly HMAC-signed, `sc_role` readable). See `src/lib/auth/`.

Money: **paisa (integers)** on newer tables (`ingredients.cost_per_unit_paisa`,
`orders.total_paisa`, `payments.amount_paisa`). Older tables
(`menu_items.price`, `orders.total_amount`, `order_items.price/subtotal`)
are still **rupee decimals**. Don't mix the two without converting via
`src/lib/money.ts`.

Schema baseline is `docker/schema.sql`. Incremental changes are also applied
idempotently at server boot from `src/lib/db/index.ts` (`runMigrations()`) -
so the live DB can be slightly ahead of `docker/schema.sql` if that file
wasn't updated (this has happened before, e.g. the `addons` table).

---

## 2. What already exists for inventory - and why the client rejected it

There's already a **basic** inventory module (Module 1 of the original spec).
It is manual-entry only and is what the client called "not detailed enough."
Existing pieces (all in this repo, don't duplicate them, integrate with or
replace them):

- `ingredients` table - `name`, `unit` (free text, e.g. "kg", "g", "ml", "pcs"),
  `current_stock numeric(12,3)`, `low_stock_threshold`, `cost_per_unit_paisa`,
  `is_perishable`, `expiry_date` (single date, not per-batch/FIFO).
- `stock_transactions` - append-only ledger. `type` enum:
  `purchase | sale_deduction | manual_adjustment | expired_removal`.
  A DB trigger (`apply_stock_transaction`) applies `quantity` (signed) onto
  `ingredients.current_stock` whenever a row is inserted - **never write
  `current_stock` directly, always insert a ledger row.**
- `recipes` (1 row per `menu_item_id`) + `recipe_ingredients`
  (`recipe_id, ingredient_id, quantity numeric(12,3)`) - a menu item's
  "bill of materials" in ingredient base units.
- Trigger chain already recomputes menu item cost automatically: editing
  `recipe_ingredients` or an ingredient's `cost_per_unit_paisa` calls
  `recompute_menu_item_cost()` → writes `menu_items.cost_price_paisa`. This
  costing math is correct and working - keep it, or re-home it in the new
  project, but don't duplicate it in two places with two answers.
- UI: `/dashboard/inventory` (`InventoryClient.tsx`, `IngredientModal.tsx`,
  `StockUpdateModal.tsx`) - CRUD ingredients, log purchase/adjustment/removal,
  see low-stock (`current_stock <= low_stock_threshold`) and expiry
  (`days_to_expiry`) flags. Manager/admin only (staff has no access - locked
  down deliberately, see §5).
- API: `/api/ingredients`, `/api/ingredients/[id]`,
  `/api/ingredients/[id]/stock`, `/api/ingredients/low-stock`,
  `/api/ingredients/expiring`, `/api/recipes`, `/api/recipes/[id]`.

### The actual gap (this is the whole point of the new project)

**Nothing ever deducts stock automatically.** `sale_deduction` exists as an
enum value on `stock_transactions.type` and `orders.stock_deducted_at` exists
as a column - both are dead: grep the codebase and neither is ever written.
`/api/ingredients/[id]/stock` explicitly whitelists only
`purchase | manual_adjustment | expired_removal`; `sale_deduction` was
planned but never wired up. Every gram of stock currently leaves the ledger
by a human typing a manual adjustment. This is exactly the hole the new
project needs to fill, plus everything else the client wants (smallest-unit
granularity, batch/FIFO expiry instead of one date per ingredient, real
analytics/forecasting dashboard, etc.).

---

## 3. Order data model (what the new project needs to read to deduct stock)

`orders.pos_status` state machine (this is the source of truth for order
progress, not `orders.status` which is a legacy column from the old
customer-facing QR flow):

```
OPEN → KOT_SENT → BILLED → AWAITING_PAYMENT → PAID
                                             ↘ PAYMENT_FAILED
                                             ↘ REQUIRES_VERIFICATION
   (any state) → CANCELLED
```

- **OPEN**: waiter is building the order, nothing sent to kitchen yet.
- **KOT_SENT**: `POST /api/pos/orders/[id]/kot` - this is the "the kitchen
  has started making it" moment. Items are split by category to
  `kot_tickets` (food → `kitchen`, beverage → `beverage_counter`) and
  printed. **This is the natural trigger point for stock deduction** - it's
  also literally what `orders.kot_sent_at` / `stock_deducted_at` already
  imply was the intended design. Note KOT can fire more than once per order
  (add-on items ordered after the first KOT get their own follow-up ticket,
  detected via `created_at > kot_sent_at`) - so deduction has to be
  per-item/idempotent, not "once per order."
- **BILLED / AWAITING_PAYMENT / PAID**: billing + Pine Labs A910S payment
  terminal flow, no bearing on stock.
- **CANCELLED**: an order or individual item can be cancelled - if
  deduction already happened at KOT time, cancellation needs to reverse it
  (insert a compensating ledger row, don't mutate history).

`order_items` - one row per line item on an order:
`menu_item_id, name, price, quantity, subtotal, status, category, addons_json`.
`addons_json` is a JSON array of `{ id, name, price }` for extras selected on
that line (add-ons live in a separate `addons` cafe-level catalog table,
`{ id, cafe_id, name, price, is_active, sort_order }` - currently these are
**not** costed against ingredients at all; if the client wants add-ons to
also deduct stock, that recipe-linking doesn't exist yet either).

So to deduct stock for one order item you need:
`order_items.menu_item_id` → `recipes.menu_item_id` → `recipe_ingredients`
(ingredient_id, quantity-per-unit) → multiply by `order_items.quantity` →
one `stock_transactions` (`type='sale_deduction'`) row per ingredient, with
`reference_order_id` set to the order id for traceability.

---

## 4. Integration options (open decision, not made yet)

Two realistic shapes - pick one, don't blend:

**A. Shared database.** The new project reads/writes the same Postgres
(`ingredients`, `recipes`, `recipe_ingredients`, `stock_transactions`
tables) directly. Simplest, zero network calls, but two codebases now both
own that schema - migrations must stay coordinated (see the
`docker/schema.sql` + `runMigrations()` mirroring rule in `claude.md`).

**B. API/webhook integration, separate database.** This POS stays the
system of record for orders; the new project becomes the system of record
for ingredients/recipes/stock and exposes its own API. This repo would call
out (webhook on KOT-send, `POST` with `{ order_id, items: [{ menu_item_id,
quantity, addons }] }`) to the new project, which resolves recipes and
deducts on its own. Cleaner ownership boundary, but the recipe-costing
trigger chain that lives here today (§2) would need to move over too, or
you'd have menu pricing and inventory disagreeing about what a recipe is.

Whichever is chosen, auth for that connection should follow the existing
pattern used for the one other external integration this repo has -
`/api/webhooks/pinelabs?token=...` (a shared-secret query token, see
`docker-compose.yml` / `.env` for how secrets are provisioned) - not a new
scheme invented from scratch.

---

## 5. Conventions to match if the new project shares this codebase's style

- TypeScript strict, no `any` without a comment explaining why.
- All DB access through one shared client (`getDb()` pattern, `src/lib/db`)
  - never instantiate ad hoc connections per request.
- Tailwind only, no CSS modules/inline styles, if it's also a Next.js
  dashboard-style UI.
- `page.tsx` (server, fetches data) + `XClient.tsx` (client component,
  interactivity) pairing throughout `/dashboard/*` - follow it if the new
  UI lives in this same app; irrelevant if it's a fully separate deploy.
- RBAC: inventory editing is manager/admin only, staff has zero access
  (`requireManagerOrAdmin` guard) - this was a deliberate, recent lockdown,
  keep it if the new system also exposes any UI/API staff could reach.
- Structured logging via `@/lib/logger` for anything server-side.

---

## 6. Useful file map (this repo, for reference while building the new one)

```
docker/schema.sql                                  full current schema baseline
src/lib/db/index.ts                                 getDb() + auto-applied migrations
src/lib/types/index.ts                               friendly type aliases (Ingredient, Recipe, OrderItem, ...)
src/lib/auth/requireDashboardSession.ts               role guards
src/app/api/ingredients/                              Module 1 API (CRUD, stock ledger, low-stock, expiring)
src/app/api/recipes/                                   recipe <-> ingredient linking API
src/app/api/pos/orders/[id]/kot/route.ts               KOT-send - the "order is now being made" trigger point
src/app/(dashboard)/dashboard/inventory/               existing (basic) inventory UI
docs/IMPLEMENTATION_PLAN.md                            original gap analysis / data model / milestone plan
docs/SMART_CAFE_TRACKER.md                             live status of what's built in this repo
```
