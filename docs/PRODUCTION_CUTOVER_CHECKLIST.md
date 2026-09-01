# Production Cutover Checklist (M9)

Run through this before pointing a real cafe at this system. Grouped by what
breaks the business if skipped, not by module number.

---

## 1. Credentials & secrets

- [ ] Rotate the seeded logins (`admin` / `manager` / `staff`, seeded by
      `supabase/migrations/005_rbac.sql`). The login route refuses the default
      passwords in production unless `ALLOW_DEFAULT_CREDENTIALS=true`, which
      must NOT be set for a real cafe.
- [ ] Set a fresh, random `AUTH_SESSION_SECRET` (`openssl rand -hex 32`).
- [ ] Set `PINELABS_WEBHOOK_SECRET` and register the Post Back URL as
      `https://<domain>/api/webhooks/pinelabs?token=<secret>`.
- [ ] Set `CRON_SECRET` for the manual reconciliation endpoint.
- [ ] Fill in real `PINELABS_MERCHANT_ID` / `PINELABS_SECURITY_TOKEN` /
      `PINELABS_STORE_ID`, and point `PINELABS_BASE_URL` at the **production**
      host confirmed with Pine Labs (the default is UAT).
- [ ] `PAYMENT_PROVIDER=pinelabs`. The app refuses to serve payments on the
      mock provider when `NODE_ENV=production`, so a missing value fails loudly
      rather than approving orders for free.

## 2. Pine Labs payment

- [ ] `terminals.client_id` rows match the real `ClientId` of each physical
      A910S, with `section_id` set so bills route to the right device.
- [ ] Ran the UAT matrix from `PINELABS_INTEGRATION_MASTER.md` §14 against real
      terminals, including: network drop mid-charge, app restart mid-charge,
      duplicate webhook, late webhook, cancel before PIN, and a deliberate
      amount mismatch.
- [ ] Confirmed which payment modes are enabled on the account and that
      `ALLOWED_MODE_CODE` in `pay/route.ts` matches.
- [ ] Reconciler running (check for `payment.reconcile.scheduled` in the logs)
      and an alert exists for orders in `REQUIRES_VERIFICATION`.
- [ ] Read `docs/PAYMENT_OPERATIONS.md` with whoever runs the floor - they need
      to know that `REQUIRES_VERIFICATION` means "check the terminal", never
      "charge again".

## 3. KOT printers (Module 5)

- [ ] Real network/Bluetooth printer client implemented behind
      `PrinterService`, swapped in for `MockPrinterService`.
- [ ] Printer model + connectivity (network vs Bluetooth) confirmed with the
      client per station (kitchen, beverage counter).
- [ ] Physical test: send a KOT, confirm both tickets print at the correct
      physical printer, not just in server logs.
- [ ] Decide and implement what happens on a real print failure (paper out,
      printer offline) - right now a print error surfaces as a 500 to the
      waiter and leaves the order `OPEN` (safe - no ticket recorded - but no
      offline print queue exists yet).

## 4. Data & migrations

- [ ] `supabase db push` (or equivalent) applied against the production
      project - both `001_initial_schema.sql` and `002_smart_cafe_foundations.sql`.
- [ ] Demo seed data (`demo_cafe.sql`, `002_smart_cafe_seed.sql`) **not**
      applied to production - replace with the real cafe's sections, tables,
      menu, ingredients, recipes, and terminal(s).
- [ ] `src/lib/types/database.generated.ts` regenerated against the
      production schema (`supabase gen types typescript`) so the app's types
      match what's actually deployed.

## 5. Idempotency & offline behavior (verify, don't just trust the code)

- [ ] Double-click "Pay" quickly on a real BILLED order - confirm only one
      charge fires (the atomic claim in `pay/route.ts` should make the second
      click hit the reconciliation path, not a second charge).
- [ ] Kill the server process (or block outbound network) between charge and
      finalize, restart, then retry payment on the same order from the UI -
      confirm it reconciles via `GetStatus` instead of charging again, and
      that stock is deducted exactly once (`stock_transactions` has one
      `sale_deduction` batch per order, not two).
- [ ] Retry a KOT send after killing the process between the two stations'
      prints - confirm the already-ticketed station is not reprinted
      (`kot.print.skipped_duplicate` in the logs) and the other one is.
- [ ] Confirm a webhook/poll-based reconciliation job exists for orders that
      go `AWAITING_PAYMENT` and are simply abandoned (waiter never comes
      back to retry) - this is separate from the interactive retry path
      above and is scoped to M6, not yet built.

## 6. Observability

- [ ] Confirm `src/lib/logger.ts`'s structured JSON lines
      (`payment.charge.*`, `payment.status.*`, `payment.reconcile.*`,
      `payment.finalize.*`, `kot.print.*`) are actually captured by the
      production host's log pipeline (Vercel log drain, PM2 log file, etc.) -
      right now they only go to stdout/stderr.
- [ ] Decide on an alerting rule for `payment.route.error` / `kot.print.error`
      at error level - nothing pages anyone today.

## 7. General app hardening

- [ ] `npx tsc --noEmit` and `npm run build` clean against production env vars.
- [ ] `npm audit` reviewed - `next@14.2.0`'s known advisories were flagged as
      pre-existing during M0 and not yet addressed; decide whether to upgrade
      before go-live.
- [ ] Confirm `/dashboard/**` and `/pos/**` are unreachable without a session
      cookie in the deployed environment (middleware gate), not just locally.
- [ ] Confirm the customer-facing QR flow (`/menu/[tableId]`) and the
      waiter POS (`/pos`) are not both editable by an anonymous customer -
      only `/pos` is behind the dashboard session; the QR flow is
      intentionally public.

## 8. Rollback plan

- [ ] Note the pre-cutover migration/seed state so a bad production seed can
      be reverted without touching `orders`/`payments` history.
- [ ] Confirm `MOCK_PAYMENT_OUTCOME` and any other mock-only env vars are
      unset/ignored once `PineLabsCloudProvider` is live, so a stray env var
      can't silently fall back to mock behavior in production.

---

Nothing above is automated - this is a manual sign-off list, run once per
environment before it takes real orders.
