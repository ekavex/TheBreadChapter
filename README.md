# The Bread Chapter - Smart Cafe Management System

Inventory, recipe costing, waiter-operated POS with KOT routing, Pine Labs terminal
payments, and analytics/reporting for a single cafe - built on top of an existing
Next.js 14 + PostgreSQL cafe-ordering codebase.

**Start here:**
- [`docs/Smart_Cafe_SRS (2).docx`](docs/Smart_Cafe_SRS%20%282%29.docx) - the client's requirements (Modules 1–11). Source of truth for *what*.
- [`docs/DEVELOPER_HANDOVER_MASTER.md`](docs/DEVELOPER_HANDOVER_MASTER.md) - the build guide: architecture, flows, rules, build order. Source of truth for *how*.
- [`docs/PINELABS_INTEGRATION_MASTER.md`](docs/PINELABS_INTEGRATION_MASTER.md) - full Pine Labs A910S cloud payment API spec.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) - gap analysis, data model, API surface, milestone build order for *this* codebase.
- [`docs/SMART_CAFE_TRACKER.md`](docs/SMART_CAFE_TRACKER.md) - **live status**: what's built, how it was tested, what's next. Check this first before picking up work.

---

## What this actually is

The base codebase (`src/app/menu/[tableId]`, `/kitchen`, `/order/[orderId]`, cart, Razorpay)
was originally a **customer-facing QR self-order** system. That flow still exists and
still works, but it is **not** part of this project's scope and isn't being extended -
leave it alone unless told otherwise. The Smart Cafe system being built here is a
**waiter-operated POS + back-office** product:

- **Waiter POS** (in progress) - select a table by section → build an order → KOT
  splits Food/Beverage to separate printers → generate bill → take payment on a
  Pine Labs A910S terminal (UPI QR / card / cash).
- **Manager dashboard** (`/dashboard/*`) - inventory, recipes & costing, menu, sales,
  P&L, area/customer analytics, reports.
- **Auth is flat, not role-based** (Module 9): one credential pair gates the dashboard,
  a second, separate pair is re-verified per action for menu Add/Edit/Delete. Not
  Supabase Auth - see `src/lib/auth/`.
- **Money is stored in paisa** (integers) on every new table (`ingredients`, `payments`,
  `orders.total_paisa`, etc.) - convert once at the UI boundary via `src/lib/money.ts`.
  Older tables (`menu_items.price`, `orders.total_amount`) still use rupee decimals;
  don't mix the two without converting.
- **Pine Labs and KOT printers are both mocked** behind `PaymentProvider` /
  `PrinterService` interfaces (`src/lib/payment/`, `src/lib/printer/`) until real
  terminal/printer credentials exist. Business logic never touches HTTP/paisa/tag
  parsing directly - swap the mock for a real implementation with zero logic changes.

Check `docs/SMART_CAFE_TRACKER.md` for exactly which milestones are done.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript (strict), Tailwind CSS |
| Backend | Next.js API Routes |
| Database | Self-hosted PostgreSQL (via the `postgres` npm client), raw SQL migrations (no ORM) |
| Auth | Custom flat two-credential system (`src/lib/auth/`) - **not** Supabase Auth |
| Payments | `PaymentProvider` interface - `MockPaymentProvider` now, Pine Labs A910S cloud integration later |
| Printing | `PrinterService` interface - `MockPrinterService` now, real KOT thermal printers later |
| State | Zustand (customer cart only - legacy QR flow) |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Database

A plain local PostgreSQL instance - no external service required.

```bash
createdb breadchapter
psql -d breadchapter -f docker/schema.sql
psql -d breadchapter -f supabase/seed/demo_cafe.sql
psql -d breadchapter -f supabase/seed/002_smart_cafe_seed.sql
```

`docker/schema.sql` is the up-to-date baseline (equivalent to every file in
`supabase/migrations/` applied in order - that folder is kept as the historical,
one-change-per-file record, but a fresh DB doesn't need to replay it). Copy
`.env.local.example` → `.env.local` and set `DATABASE_URL` to point at it (plus
`AUTH_SESSION_SECRET` - any long random string).

Any migration added *after* your last `docker/schema.sql` pull is applied automatically
the first time the app starts - see `src/instrumentation.ts`.

### 3. Production (Docker)

`docker-compose.yml` mounts `docker/schema.sql` as a Postgres init script, so a fresh
container bootstraps itself on first boot. Later schema changes ship as entries in
`src/instrumentation.ts` and apply automatically on deploy - no manual `psql` step.

### 4. Start the dev server

```bash
npm run dev
```

### Seeded login credentials

**Change these before any real deployment** - they're seeded in `002_smart_cafe_seed.sql`.

| Scope | User ID | Password | Used for |
|---|---|---|---|
| Dashboard access | `manager` | `ChangeMe123!` | `/login` → gates all of `/dashboard/*` |
| Menu CRUD | `admin` | `MenuCrud123!` | Popup re-verification on menu item Add/Edit/Delete (M3) |

---

## URL Structure (current)

| URL | Description |
|---|---|
| `/login` | Dashboard-access login |
| `/dashboard` | Manager dashboard overview |
| `/dashboard/inventory` | Ingredients, stock ledger, low-stock/expiry alerts |
| `/dashboard/menu-manager` | Menu category/item CRUD |
| `/dashboard/orders` | Order list |
| `/dashboard/analytics` | Charts/insights |
| `/kitchen` | Kitchen display (Kanban, realtime) |
| `/api/ingredients`, `/api/ingredients/[id]`, `/api/ingredients/[id]/stock`, `/api/ingredients/low-stock`, `/api/ingredients/expiring` | Inventory (Module 1) |
| `/api/auth/login`, `/logout`, `/verify-menu-credentials` | Auth (Module 9) |
| `/menu/[tableId]`, `/order/[orderId]` | **Legacy** customer QR self-order flow - untouched, not part of this project |

See `docs/IMPLEMENTATION_PLAN.md` for the full planned API surface (recipes, POS/KOT/bill,
payments, reports, etc.) as later milestones land.

---

## Folder Structure

```
├── docs/                          ← SRS, developer handover, Pine Labs spec, plan, tracker
├── src/
│   ├── app/
│   │   ├── login/                 ← dashboard-access login
│   │   ├── (dashboard)/dashboard/
│   │   │   ├── inventory/         ← Module 1
│   │   │   ├── menu-manager/
│   │   │   ├── orders/
│   │   │   └── analytics/
│   │   ├── api/
│   │   │   ├── auth/              ← login, logout, verify-menu-credentials
│   │   │   ├── ingredients/       ← Module 1
│   │   │   ├── menu/ orders/ tables/  ← from the original base codebase
│   │   ├── menu/[tableId]/        ← legacy customer QR flow (untouched)
│   │   ├── kitchen/
│   │   └── order/[orderId]/
│   ├── components/                ← menu/, kitchen/, dashboard/ (from base codebase)
│   ├── lib/
│   │   ├── auth/                  ← session signing, credential check, menu-CRUD guard
│   │   ├── payment/                ← PaymentProvider + MockPaymentProvider
│   │   ├── printer/                ← PrinterService + MockPrinterService
│   │   ├── money.ts                ← paisa ↔ rupee conversion
│   │   ├── db/                     ← getDb() - the shared `postgres` client
│   │   └── types/
│   │       ├── database.generated.ts  ← row types - see below
│   │       └── index.ts               ← friendly type aliases derived from the above
│   └── middleware.ts               ← gates /dashboard/* and /pos/* on the dashboard session
├── src/instrumentation.ts          ← auto-applies pending migrations on server startup
└── supabase/
    ├── migrations/                 ← one file per schema change, historical record
    └── seed/                       ← demo_cafe.sql, 002_smart_cafe_seed.sql
```

### Updating `database.generated.ts`

There's no codegen step - `database.generated.ts` is hand-maintained. After any migration
that adds/renames/removes a column or table, update the corresponding `Row`/`Insert`/`Update`
type there by hand, then adjust the friendly aliases in `src/lib/types/index.ts` if needed.

---

## Conventions

- TypeScript strict mode - DB row types are `type` aliases, never `interface` (see the
  note in `src/lib/types/index.ts`).
- All DB queries go through `getDb()` in `src/lib/db` (a shared `postgres` client) -
  never instantiate a separate connection elsewhere.
- Server components fetch data; client components (`'use client'`) handle interactivity,
  following the existing `page.tsx` (server) + `XClient.tsx` (client) + `router.refresh()`
  pattern used throughout `/dashboard/*`.
- Tailwind only - no inline styles, no CSS modules.
- Payment and printer integrations stay behind their interfaces. Never call an SDK/HTTP
  client directly from a route handler or component.
