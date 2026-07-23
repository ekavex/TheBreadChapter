# Smart Cafe — Build Tracker

> Built on `phase1`. Plan: `docs/IMPLEMENTATION_PLAN.md`. Spec: `docs/DEVELOPER_HANDOVER_MASTER.md` + `docs/PINELABS_INTEGRATION_MASTER.md` + `docs/Smart_Cafe_SRS (2).docx`.
>
> Legend: ✅ Done · 🔧 Partial · ⬜ Not started
>
> Last updated: 2026-07-23

---

## M0 — Foundations ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Migration `002_smart_cafe_foundations.sql` | ✅ | sections, terminals, ingredients, stock_transactions, recipes/recipe_ingredients (+ auto cost-recompute triggers), menu_items.category/cost_price_paisa, orders.pos_status/total_paisa/kot_sent_at/billed_at, order_items.category, kot_tickets, payments, auth_credentials |
| 2 | Seed `002_smart_cafe_seed.sql` | ✅ | 3 sections (Indoor/Outdoor/Smoking), 8 tables assigned to sections, 1 terminal, 2 auth credentials, 6 ingredients, 2 sample recipes (Cold Brew, Chocolate Croissant) |
| 3 | `PaymentProvider` interface + `MockPaymentProvider` | ✅ | `src/lib/payment/` |
| 4 | `PrinterService` interface + `MockPrinterService` | ✅ | `src/lib/printer/` |
| 5 | Auth: session signing, credential check, middleware gate | ✅ | `src/lib/auth/`, `src/middleware.ts` |
| 6 | `/login` page + `/api/auth/login`, `/logout`, `/verify-menu-credentials` | ✅ | |
| 7 | TypeScript types extended (`src/lib/types/index.ts`) | ✅ | Also fixed a pre-existing repo-wide typing gap — see "Known issues" below |

### What changed
- **New migration:** `phase1/supabase/migrations/002_smart_cafe_foundations.sql`
- **New seed:** `phase1/supabase/seed/002_smart_cafe_seed.sql`
- **New auth layer:** `src/lib/auth/{session,credentials,requireMenuCrud}.ts`, `src/middleware.ts`, `src/app/login/{page,LoginForm}.tsx`, `src/app/api/auth/{login,logout,verify-menu-credentials}/route.ts`
- **New payment/printer abstractions:** `src/lib/payment/{types,MockPaymentProvider}.ts`, `src/lib/printer/{types,MockPrinterService}.ts`
- **New env vars:** `AUTH_SESSION_SECRET`, `MOCK_PAYMENT_OUTCOME`, `PINELABS_*` (see `.env.local.example`)
- **Types:** `src/lib/types/index.ts` extended with `Section`, `Terminal`, `Ingredient`, `StockTransaction`, `Recipe`, `RecipeIngredient`, `KotTicket`, `Payment`, `AuthCredential`, and new fields on `Table`/`MenuItem`/`Order`/`OrderItem`.

### How it was tested (against a real local stack, not just type-checking)
1. Spun up `supabase start` locally (Docker) — Postgres + PostgREST + Studio, no cloud project needed.
2. Applied `001_initial_schema.sql` + `002_smart_cafe_foundations.sql` via the CLI, then `demo_cafe.sql` + `002_smart_cafe_seed.sql` via `psql` inside the DB container.
3. **Verified in Postgres directly:**
   - Cold Brew recipe cost computed as `200×5 + 10×12 + 15×6 = 1210` paisa — matches manual calc.
   - Changing Milk's `cost_per_unit_paisa` 5→6 auto-recomputed Cold Brew's cached cost to 1410 via the trigger — confirms Module 3's "ingredient cost edit → recipe cost auto-recalculates" end to end.
   - Tables correctly joined to sections (Indoor/Outdoor/Smoking) with `status='free'`.
4. **Verified against a running `npm run dev` + curl, end to end:**
   - `GET /dashboard` with no session → redirected to `/login` by the middleware.
   - `POST /api/auth/login` with wrong password → `401`.
   - `POST /api/auth/login` with seeded credentials → `200` + session cookie set.
   - `GET /dashboard` and `GET /pos` with that cookie → both pass the middleware gate (dashboard renders 200; `/pos` 404s only because M4 hasn't built the page yet — confirms the gate isn't blocking it).
   - `POST /api/auth/verify-menu-credentials` wrong/right password → `401` / `200` + short-lived token.
   - `POST /api/auth/logout` then `GET /dashboard` → redirected again.
   - `MockPaymentProvider`: charge (approved, UPI mode picked from `allowedModes`) → status → cancel → status-after-cancel, and a second instance forced to `declined` — all behaved correctly (verified via a temporary route, removed after).
   - `MockPrinterService`: KOT split logged separately to `kitchen` and `beverage_counter` stations.

### Repo-wide TypeScript gap — fully fixed (was flagged as "known issue", now resolved)
Originally flagged as a workaround; fully root-caused and fixed instead. Two independent, **pre-existing** (not introduced by this work) causes, found by bisecting against `supabase gen types typescript --local`'s own output:

1. **`interface` vs `type` for Row/Insert/Update.** The hand-written `Database` type in `src/lib/types/index.ts` declared every DB-mirroring shape (`Cafe`, `Order`, `MenuItem`, …) as `export interface X {...}`. The installed `@supabase/supabase-js` (2.106.x postgrest-js) resolves `.from(...).select(...)` through deep recursive conditional types, and a named `interface` doesn't resolve through that recursion the same way a `type` alias to the identical object shape does — it silently collapses to `never`. Confirmed by isolated repro: identical shape, `interface` fails / `type` alias succeeds. **Fix:** converted every DB type to a `type` alias.
2. **`@supabase/ssr` was pinned at `0.3.0`** (latest: `0.12.3`) with its own bundled/vendored generic types, stale relative to the installed postgrest-js — broke `.from()` calls specifically on pages using `createServerSupabaseClient()` (which wraps `@supabase/ssr`'s `createServerClient`), even after fix #1. **Fix:** upgraded `@supabase/ssr` to `^0.12.3` and `@supabase/supabase-js` to `^2.110.8` (peer requirement). The old `get`/`set`/`remove` cookie API `src/lib/supabase/server.ts` already used is still supported (deprecated but functional overload) — no code changes needed there.
3. **Embedded/joined selects** (e.g. `select('*, items:order_items(*)')`) additionally need real `Relationships` foreign-key metadata, not `Relationships: []` — hand-maintaining that is exactly what `supabase gen types typescript --local` is for. **Fix:** `src/lib/types/database.generated.ts` is now the auto-generated, regenerate-after-every-migration source of truth; `src/lib/types/index.ts` derives all friendly type aliases (`Cafe`, `Order`, `MenuItem`, etc.) from it, narrowing only the handful of CHECK-constrained TEXT columns (`pos_status`, `scope`, `station`, payment `status`) and JSONB (`settings`) that codegen can't narrow on its own.

A few pre-existing call sites (`dashboard/page.tsx`, `menu/[tableId]/page.tsx`, `api/orders/route.ts`) needed a one-line cast or narrower local type at the query boundary, since our friendly types are intentionally stricter than raw generated columns.

**Verified:**
- `npx tsc --noEmit` — **zero errors**, repo-wide (was 22 errors across 7 files before).
- `npm run build` — full production build succeeds (static generation, all routes, middleware bundle).
- `npm run dev` + curl — `/login`, `POST /api/auth/login`, `/dashboard` (uses the embedded-select query that was failing), and `/menu/1?cafe=sunrise-cafe` (pre-existing customer QR page, also via `createServerSupabaseClient`) all return `200` with real data, no runtime regressions from the `@supabase/ssr` upgrade.

**Remaining, unrelated:** `npm audit` reports 14 vulnerabilities (mostly `next@14.2.0`'s known advisory) — pre-existing, not addressed here; flagging in case you want to upgrade Next separately. Cosmetic Next.js warnings about `viewport`/`themeColor` in `metadata` exports (pre-existing across most pages) are unrelated to this fix and don't fail the build.

### How to run it yourself
```
cd phase1
npx supabase start        # local Postgres+API, needs Docker Desktop running
npm run dev                # http://localhost:3000
```
Seeded credentials (**change before any real deployment**):
- Dashboard login (`/login`): `manager` / `ChangeMe123!`
- Menu-CRUD popup (wired in M3): `admin` / `MenuCrud123!`

---

## M1 — Inventory management ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `GET/POST /api/ingredients` | ✅ | GET adds computed `is_low_stock` + `days_to_expiry` per row |
| 2 | `PATCH/DELETE /api/ingredients/[id]` | ✅ | `current_stock` deliberately not PATCHable — only via the stock ledger. DELETE returns 409 with a clear message if the ingredient is still used in a recipe (FK violation) |
| 3 | `POST /api/ingredients/[id]/stock` | ✅ | purchase / manual_adjustment / expired_removal — inserts into `stock_transactions`, DB trigger applies the delta to `current_stock`. Purchase can optionally move the tracked expiry date (only if the new date is sooner) |
| 4 | `GET /api/ingredients/low-stock`, `GET /api/ingredients/expiring?days=` | ✅ | |
| 5 | `/dashboard/inventory` page + Add/Edit/Update-stock modals | ✅ | Follows the existing menu-manager server-component + client-component + `router.refresh()` convention |
| 6 | `src/lib/money.ts` (paisa↔rupee helpers) | ✅ | Small shared util — money is paisa in the new tables, rupees in the old ones; needed repeatedly from here through M2/M4/M6 |
| 7 | Sign-out button in dashboard sidebar | ✅ | Small gap-fill: M0 added a real login gate but no way to log out from the UI |
| 8 | Inventory nav link | ✅ | Added to `(dashboard)/dashboard/layout.tsx` |

**Auth note:** inventory CRUD only requires the standard dashboard session (already covered by the M0 middleware on `/dashboard/:path*`). The SRS's second menu-CRUD credential (Module 9) is scoped specifically to *menu item* Add/Edit/Delete — that gate lands in M3, not here.

### How it was tested (against the same live local stack)
- `npx tsc --noEmit` — clean.
- `npm run dev` + curl, logged in as `manager`:
  - `GET /dashboard/inventory` → 200, without a session cookie → 307 to `/login` (middleware still enforced).
  - `GET /api/ingredients` → correct `is_low_stock`/`days_to_expiry` for all 6 seeded ingredients.
  - Created a new ingredient (Cheese, 50gm, threshold 100) → correctly appeared in `/api/ingredients/low-stock`.
  - Ran all three stock transaction types end to end: purchase +200 → 250, manual adjustment −20 → 230, expired removal −30 → 200 (matches `50+200-20-30=200` by hand).
  - Purchase with a *later* expiry didn't move the tracked date; a subsequent purchase with an *earlier* expiry did — confirms the "nearest upcoming expiry" rule.
  - `PATCH` rename + threshold change → applied correctly; a `PATCH` containing only `current_stock` is stripped down to nothing and now returns a clean `400 "No valid fields to update"` (previously fell through to a DB error — fixed).
  - `DELETE` on the unused Cheese ingredient → 200; `DELETE` on Milk (used in the seeded Cold Brew recipe) → 409 with a clear message, ingredient untouched.
  - `GET /api/ingredients/expiring?days=5` → correctly returned Bread/Vegetables/Milk in ascending expiry order, excluded the two non-perishables.
  - Validation: zero quantity, negative purchase amount, and an invalid `type` are all rejected with `400`.
- `npm run build` — clean.

## M2 — Recipes & dynamic costing ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `GET /api/recipes?menuItemId=` | ✅ | Returns the recipe + ingredient lines (embedded join) for a menu item, or `null` if it doesn't have one yet |
| 2 | `POST /api/recipes` | ✅ | Create a recipe (`menu_item_id` + ingredient/quantity lines) — cost recompute is entirely DB-trigger-driven (built in M0), not application logic |
| 3 | `PATCH /api/recipes/[id]` | ✅ | Replaces the ingredient lines wholesale (delete + reinsert) |
| 4 | `DELETE /api/recipes/[id]` | ✅ | Removes the recipe; explicitly zeroes `cost_price_paisa` as a defensive backstop regardless of cascade-trigger timing |
| 5 | `RecipeModal.tsx` | ✅ | Ingredient-line editor with a live client-side cost/profit preview before saving |
| 6 | Menu Manager UI: cost/profit display, food/beverage badge, "Recipe" button | ✅ | Extends the existing `MenuManagerClient.tsx` rather than a new page |

**Note:** menu item `category` (food/beverage) is now *displayed* per item (seeded in M0) but there's no edit UI for it yet — assigning/changing it is bundled into M3's full item CRUD, which is also where the menu-CRUD popup gate applies. Recipe editing itself is **not** gated behind the menu-CRUD credential — the SRS scopes that popup to menu item Add/Edit/Delete specifically, and a recipe isn't the menu item itself.

### How it was tested (live, same local stack)
- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `npm run dev` + curl, logged in as `manager`:
  - `GET /dashboard/menu-manager` → 200.
  - Fetched the seed-created Cold Brew recipe → correct embedded ingredient lines (Milk/Coffee Powder/Sugar) with full ingredient detail joined in.
  - `POST` a new recipe on Masala Chai (100ml milk + 5gm sugar) → `menu_items.cost_price_paisa` came back as `530` (= `100×5 + 5×6`, matches hand calc).
  - `PATCH` replaced the lines (150ml milk + 10gm coffee) → cost recomputed to `870` (= `150×5 + 10×12`) — confirmed both in the PATCH response and by re-fetching `/api/menu` separately.
  - `PATCH` with an empty `lines` array → clean `400`.
  - `DELETE` the recipe → `cost_price_paisa` back to `0` on the menu item.
  - No server errors in the dev log across any of the above.

## M3 — Menu CRUD + auth hardening ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `POST /api/menu/categories`, `PATCH/DELETE /api/menu/categories/[id]` | ✅ | Menu-CRUD gated. DELETE blocks (409) if the category still has items — the DB's `ON DELETE CASCADE` would otherwise silently wipe them |
| 2 | `POST /api/menu/items`, `PATCH/DELETE /api/menu/items/[id]` | ✅ | Menu-CRUD gated. `category` (food/beverage) required on create — drives KOT routing later. DELETE returns 409 if the item has prior orders (FK violation), suggesting "mark unavailable" instead |
| 3 | `MenuCrudGateModal.tsx` | ✅ | The Module 9 popup — "click Add/Edit/Delete → enter menu credentials → verified → action proceeds." Re-verified per action (2min token), not a session |
| 4 | `ItemModal.tsx`, `CategoryModal.tsx` | ✅ | Full add/edit forms, gated behind the popup above |
| 5 | Existing `PATCH /api/menu` (availability toggle) left ungated | ✅ (deliberate) | SRS scopes the menu-CRUD popup to Add/Edit/Delete specifically; toggling sold-out is an operational action, not "editing the menu" |
| 6 | **Auth hardening**: `requireDashboardSession` guard | ✅ | New — added to *every* dashboard-only API route (ingredients, recipes, and the new menu category/item routes) that had no auth check beyond the page-level middleware. Menu-CRUD routes now require **both** a dashboard session **and** the menu-crud token |

**Gap found and fixed along the way:** testing revealed that `/api/ingredients*`, `/api/recipes*`, and the new menu category/item routes were callable directly with no session cookie at all — the middleware only protects the `/dashboard/*` *pages*, not these API routes independently. Since M3 is explicitly the auth-hardening milestone, closed this properly with `src/lib/auth/requireDashboardSession.ts` rather than leaving it as a known gap.

### How it was tested (live, same local stack)
- `npx tsc --noEmit` — clean. `npm run build` — clean.
- Logged in as `manager`, verified as `admin`/`MenuCrud123!`, then against the running dev server + local Supabase:
  - Category/item create without a menu-crud token → `401`. Wrong menu-crud password → `401`. Valid token → succeeds.
  - Created a category + food item, edited price and switched it to `beverage`, rejected an invalid `category` value with `400`.
  - Tried deleting a category that still had an item → `409` with a clear message; deleted the item, then the now-empty category deleted cleanly.
  - **FK-protection regression**: manually inserted a real `order_items` row referencing the seeded "Vada Pav" item, then confirmed `DELETE /api/menu/items/[id]` correctly blocked with `409` ("mark unavailable instead") and left the item untouched; cleaned up the test order afterward.
  - Confirmed the availability-toggle endpoint (`PATCH /api/menu`) still works with **no** menu-crud token, as intended.
  - **Hardening regression**: every one of `/api/ingredients`, `/api/ingredients/[id]`, `/api/ingredients/[id]/stock`, `/api/ingredients/low-stock`, `/api/ingredients/expiring`, `/api/recipes`, `/api/recipes/[id]`, and the new menu routes now returns `401 "Dashboard session required"` with zero cookies — then re-ran the full M1/M2/M3 flows logged in as `manager` to confirm nothing broke.

## M4 — Waiter POS: order, KOT, bill (mock payment) ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `GET /api/pos/tables` | ✅ | Sections + tables with live status, for the table-select screen |
| 2 | `POST /api/pos/orders` | ✅ | Opens a new order on a free table (→ `occupied`); resumes the existing open order if the table isn't free (no duplicate orders) |
| 3 | `GET /api/pos/orders/[id]` | ✅ | Full order detail for the order-builder screen |
| 4 | `POST /api/pos/orders/[id]/items`, `DELETE .../items/[itemId]` | ✅ | Merges repeat adds of the same (uncustomised) item into one line; items lock once KOT is sent |
| 5 | `POST /api/pos/orders/[id]/kot` | ✅ | Splits by `menu_items.category`, prints one ticket per station via `PrinterService`, logs to `kot_tickets`, table → `kot_sent` |
| 6 | `POST /api/pos/orders/[id]/bill` | ✅ | Computes subtotal/tax/service-charge/total from `cafes.settings`, table → `billed` |
| 7 | `POST /api/pos/orders/[id]/pay` | ✅ | charge → status → idempotent finalize against `PaymentProvider`; on approval deducts stock per recipe and frees the table; on decline/cancel → `PAYMENT_FAILED`, table stays `billed` so the waiter can retry |
| 8 | `POST /api/pos/orders/[id]/cancel` | ✅ | Releases the table from any non-terminal state; best-effort cancels an in-flight payment |
| 9 | `/pos` (table select) + `/pos/order/[orderId]` (order builder) | ✅ | Waiter-facing UI — section/table grid, menu browser, order lines, and per-state action area (send to kitchen / generate bill / pay / receipt) |
| 10 | Nav link to `/pos` from the dashboard sidebar | ✅ | |

### Two real bugs found and fixed while testing this milestone

1. **App-wide stale-GET bug (not POS-specific).** Testing table-status transitions turned up live, reproducible staleness: the DB had the correct value, but the API kept returning the old one. Root cause: Next.js's App Router patches the global `fetch` and caches GET requests by default — including the ones `@supabase/supabase-js` makes internally to PostgREST. `export const dynamic = 'force-dynamic'` on the route (which I tried first) did **not** reliably fix it. The actual fix: pass a custom `fetch` that forces `cache: 'no-store'` into both `createAdminClient()` and `createServerSupabaseClient()` in `src/lib/supabase/server.ts` — a single, central fix covering every route in the app, present and future. Verified by bypassing Next.js entirely (a standalone Node script hitting the same local Supabase instance) to confirm the DB and supabase-js were never the problem. Also added `export const dynamic = 'force-dynamic'` to every existing GET route as defense-in-depth (harmless, possibly redundant given the fetch-level fix, but cheap insurance).
2. **Table-status-in-response ordering bug.** In `kot`/`bill`/`pay`/`cancel`, each route fetched the order (embedding `table:tables(*)`) *before* updating that same table's status, then returned that embed — so the response's `order.table.status` was always one step behind. Didn't surface in the current UI (which only reads `table.number`/`section.name`, never embedded `table.status`), but was a real API-correctness bug. Fixed by reordering: update the table first, then do the final order update+select.

### How it was tested (live, against the real running stack — this is the SRS's own worked example)
- `npx tsc --noEmit` — clean. `npm run build` — clean.
- Ran the *exact* Module 5 worked example end to end: Table 4 → opened order → added 1 Chocolate Croissant (food) + 1 Cold Brew (beverage) → sent to kitchen → confirmed `kot_tickets` split correctly (Croissant → `kitchen`, Cold Brew → `beverage_counter`) and the mock printer logged both tickets separately → generated the bill (`subtotal 280, tax 14 (5%), total 294` — matches hand calc exactly) → paid via UPI → order `PAID`, `payment_method: upi`, `status: completed`, table released to `free`.
- **Stock deduction verified against hand-calculated ingredient math**: Bread 200→198 (−2 for the croissant recipe), Butter 3000→2990 (−10), Milk 20000→19800 (−200 for Cold Brew), Coffee Powder 5000→4990 (−10), Sugar 8000→7985 (−15) — cross-checked against the `stock_transactions` audit rows.
- **Decline + retry**: flipped `MOCK_PAYMENT_OUTCOME=declined`, ran a full order through to payment → `PAYMENT_FAILED`, table stayed `billed`, **no stock was deducted**. Flipped back to `approved` and retried payment on the *same* order → `PAID`, stock deducted correctly this time.
- **Guards**: resuming an already-occupied table returns the same order (no duplicate); paying before billing → `409`; adding an item after KOT was sent → `409` ("items are locked"); cancelling releases the table.
- **Full regression**: re-ran M1 (ingredients/low-stock/expiring), M2 (recipe fetch), and M3 (dashboard pages, menu-CRUD token flow, legacy customer QR menu page) after the shared `server.ts` fetch-caching fix, since that file is used by every route in the app — all still pass.

## M5 — Dashboard + sales tiles ✅ DONE

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `src/lib/dashboard.ts` — `getDashboardData()` | ✅ | Single shared function computing every Module 10 tile — today's sales/profit, top seller, most-visited area, peak hour, pending orders, low-stock items, inventory value, live table statuses. Used by both the page and the API route so they can't drift apart |
| 2 | `GET /api/dashboard` | ✅ | Dashboard-session gated, `force-dynamic` |
| 3 | `SmartCafeTiles.tsx` | ✅ | Today's profit, top seller, most-visited area, peak hour, inventory value, low-stock count |
| 4 | `LowStockPreview.tsx` | ✅ | Reuses the same low-stock filter as M1's `/api/ingredients/low-stock`, links to the inventory page |
| 5 | `LiveTableGrid.tsx` | ✅ | Read-only section/table status grid (manager view — waiters act on this from `/pos`) |
| 6 | `DashboardLiveRefresher.tsx` | ✅ | Polls `router.refresh()` every 10s — the handover doc explicitly allows polling as a websocket-push fallback |
| 7 | `/dashboard` overview page rewired | ✅ | Existing 4-tile `DashboardMetrics` kept (now fed `pendingOrders` for its "active orders" tile — unifies with the SRS's "Pending Orders" concept instead of a separately-computed today-scoped duplicate), everything else added below it |

**Profit calculation:** `todaysProfit = todaysSales − Σ(menu_item.cost_price_paisa × order_item.quantity)` over today's *paid* orders — i.e. current recipe cost, not a historical snapshot at time of sale (matches the SRS's Module 3 model, where cost is always "current"). No Expense line yet — same open item as noted for M7.

### How it was tested (live, against real data from M4's testing)
- `npx tsc --noEmit` — clean. `npm run build` — clean.
- `GET /api/dashboard`, logged in as `manager`, cross-checked against the actual orders created during M4 testing (hand-tallied independently, not just re-reading the code):
  - `todaysSales: 420, todaysProfit: 379.9` — matches `(294 + 126) revenue − (26.10 + 14.00) ingredient cost` exactly.
  - `ordersToday: 4` — matches the 4 orders actually created that day (1 cancelled debug order, 1 fully paid, 1 declined-then-paid-on-retry, 1 KOT'd-then-cancelled).
  - `topSellerToday: Chocolate Croissant × 3` — correct (appeared in 3 of the 4 orders).
  - `mostVisitedArea: Indoor × 2` — correct (2 of the orders were on Indoor tables, 1 on Outdoor).
  - `pendingOrders: 0` — correct, all 4 test orders had reached a terminal state.
- Fetched the actual rendered `/dashboard` HTML (not just the API) and confirmed the live table grid's React payload shows all 8 tables, correctly grouped by section (Indoor/Outdoor/Smoking), all `Free` after M4's test orders completed/cancelled.

## M6 — Pine Labs real integration ⬜ NOT STARTED
## M7 — P&L, area & customer analytics ⬜ NOT STARTED
## M8 — Reports & exports ⬜ NOT STARTED
## M9 — Hardening ⬜ NOT STARTED
