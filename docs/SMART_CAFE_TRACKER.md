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

## M2 — Recipes & dynamic costing ⬜ NOT STARTED
## M3 — Menu CRUD + auth hardening ⬜ NOT STARTED
## M4 — Waiter POS: order, KOT, bill (mock payment) ⬜ NOT STARTED
## M5 — Dashboard + sales tiles ⬜ NOT STARTED
## M6 — Pine Labs real integration ⬜ NOT STARTED
## M7 — P&L, area & customer analytics ⬜ NOT STARTED
## M8 — Reports & exports ⬜ NOT STARTED
## M9 — Hardening ⬜ NOT STARTED
