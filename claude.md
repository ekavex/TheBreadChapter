# cafe-system/CLAUDE.md

## Project
Cafe POS + KOT + inventory system. Next.js 14 (App Router) + PostgreSQL,
Pine Labs A910S for card/UPI/cash payment. Single cafe per deployment; the
schema keeps `cafe_id` on every table, so never query without it.

## Commands
- npm run dev       - start dev server (port 3000)
- npm run build     - production build
- npm run lint      - ESLint check
- npm test          - vitest (unit; payment integration suite runs when
                      TEST_DATABASE_URL is set, skips otherwise)

## Database
- Postgres via postgres.js. All queries go through `src/lib/db/index.ts`
  (`getDb()`), written as tagged-template SQL. There is no Supabase client -
  `src/lib/types/database.generated.ts` is kept only for row types.
- Docker deploy initialises from `docker/schema.sql` + `docker/seed.sql`.
- Incremental changes go in `supabase/migrations/` **and** must be mirrored
  into `docker/schema.sql`, or fresh containers will drift from upgraded ones.
- Demo cafe ID: 11111111-1111-1111-1111-111111111111

## Key URLs
- /menu/[tableId]                  ← customer QR landing page
- /pos                             ← waiter POS (auth required)
- /kitchen                         ← kitchen display (auth required)
- /dashboard                       ← owner dashboard
- /api/health                      ← liveness + DB readiness
- /api/webhooks/pinelabs?token=…   ← Pine Labs Post Back URL

## Payments - read before touching
`docs/PAYMENT_OPERATIONS.md` is the operational contract; the invariants there
are load-bearing. In particular:
- Import the provider from `@/lib/payment/provider` only. It refuses to run the
  mock in production.
- `pending` means the terminal still has the transaction open. Never write it
  as a failure; a timeout is not a decline.
- Only `finalizeApprovedPayment` may mark an order PAID - it verifies the
  amount first and does all writes in one transaction.
- Anything ambiguous becomes `REQUIRES_VERIFICATION`, never an automatic retry.

## Code style
- TypeScript strict mode - no `any` unless commented why
- Tailwind only - no inline styles, no CSS modules
- Server components fetch data; client components handle interaction
- Structured logging via `@/lib/logger`; payment payloads pass through
  `@/lib/observability/redact` so card data never reaches logs or the database
