# Smart Cafe Management System - Developer Handover (Master)

**Version:** 2.0 (consolidated) · **Date:** July 2026
**Owner:** Project Management / System Design
**Companion docs:** `Smart_Cafe_SRS.docx` (requirements, Modules 1–11) · `PINELABS_INTEGRATION_MASTER.md` (full payment API spec)

> **How to use this document.** This is the single entry point for the engineering team. It tells you *what* to build, *how* the system fits together, the *flows*, the *rules you cannot break*, and the *order to build in*. The SRS is the requirement source of truth; this doc is the build guide and supersedes any earlier handover. For the deep Pine Labs API detail (request/response fields, codes), use the companion integration master.

---

## 1. Executive summary

We are building an in-cafe management system for a single cafe (extensible to more). Waiters take orders at the table on a web app; the system routes food and beverage tickets to separate prep stations (KOT), generates and prints a bill, takes payment on a **Pine Labs A910S** terminal (UPI / card / cash), and updates inventory, sales, and a **live dashboard** in real time. Managers use the same dashboard for analytics and reports.

**An initial codebase already exists - build on top of it.** Do not scaffold from scratch or swap frameworks without raising it first.

The scope is 11 modules (below). Three modules from the original draft (WhatsApp, Expense, Forecasting/AI) were **removed**. Ordering + KOT + payment were **consolidated into Module 5**. Authentication was **simplified to two credential sets, no roles**.

---

## 2. The architectural principle everything hangs on

**The backend is the single source of truth. Every client is thin.**

```
                 +-----------------------------+
                 |     BACKEND (API + DB)      |   ← all state lives here
                 |  tables, menu, orders,      |     (the only source of truth)
                 |  inventory, sales, payments |
                 +--------------+--------------+
                                |
        +----------------+------+------+-----------------+
        |                |             |                 |
  +-----v-----+   +------v-----+  +----v------+   +------v-------+
  |  Waiter   |   |  Manager   |  | KOT/prep  |   |  Pine Labs   |
  | web app   |   | web        |  | printers  |   |  Cloud       |
  | (order)   |   | dashboard  |  |(kitchen + |   |  → A910S     |
  |           |   |            |  | beverage) |   |  (payment)   |
  +-----------+   +------------+  +-----------+   +--------------+
```

Rules that follow (do not violate):

- No client holds authoritative state. The waiter app, manager dashboard, printers, and payment terminal are all clients of the backend.
- **The A910S is only a payment terminal.** In Pine Labs *cloud* integration the ordering app is **not** deployed on the device - so no locked-down-device app certification is needed for the order flow. (See §9.)
- "Real-time dashboard" = the backend pushes changes (websocket; polling fallback) when an order is paid, stock changes, a table frees, etc.
- Payment and KOT printing are **backend-driven side effects**, not device-local actions.

---

## 3. Technology & conventions

- **Match the existing codebase.** First task: inventory the repo - language, framework, DB, existing structure, auth, and which modules already exist. Follow its conventions. Flag before introducing anything new.
- **Integrations behind interfaces.** Payment (Pine Labs) and printers (KOT) sit behind clean, **mockable** interfaces. Ship mocks now; drop in real implementations later with zero change to business logic.
- **Money:** integers in **paisa**, never floats. Convert once at the boundary. Currency INR (₹).
- **Time:** store UTC; render in cafe-local timezone.
- **Idempotency:** every money/stock operation must be idempotent (retried webhook or poll must not double-charge or double-deduct).
- **Secrets:** Pine Labs `MerchantID`/`SecurityToken` live server-side only. Never in the browser or repo.
- **Auditability:** log all external calls and payment results (card numbers arrive already masked).

---

## 4. System modules (scope) - 11 modules

| # | Module | Notes / changes |
|---|---|---|
| 1 | Inventory Management | Ingredients CRUD, stock update, low-stock alerts, expiry tracking. |
| 2 | Recipe Management | Recipe per menu item; **auto stock deduction** on order completion. |
| 3 | Dynamic Cost Management | Ingredient cost edits → **auto recipe-cost recalculation**; menu pricing; profit. |
| 4 | Sales Management | Persist every order (id, date/time, item, qty, table, section, customer type). |
| **5** | **Order, KOT Routing & Payment** | **The heart of the system - see §7.** Table→order→KOT→bill→payment→dashboard. |
| 6 | Profit & Loss Analysis | Daily/weekly/monthly/yearly; net = revenue − ingredient cost − expenses. |
| 7 | Cafe Area Analytics | Per-section analytics, popular items, peak hours/heatmap. |
| 8 | Customer Analytics | New/repeat, most ordered, avg bill, spending trends. |
| 9 | Authentication & Security | **Two credential sets, no roles - see §8.** |
| 10 | Dashboard | Live sales/profit/low-stock/top-seller/most-visited/peak-hour/pending/inventory value/table statuses. |
| 11 | Reports | Daily/weekly/monthly; export PDF/Excel/CSV/print. |

**Removed** from the original draft: WhatsApp Integration, Expense Management, Forecasting/AI. (If Expense is later needed for accurate Net Profit, raise it - see open items §14.)

---

## 5. Data model (consolidated)

Adapt names to the existing schema; these are the entities and the fields that matter.

| Entity | Key fields | Notes |
|---|---|---|
| `Section` | id, name | Indoor, Outdoor, Smoking |
| `Table` | id, section_id, number, status | status: `free` / `occupied` / `kot_sent` / `billed` |
| `Terminal` | id, client_id, label, section_id | one row per A910S; `client_id` routes payments (§9, §11 of integration doc) |
| `Ingredient` | id, name, quantity, unit, cost_per_unit, low_stock_threshold, expiry_date | inventory + costing |
| `MenuItem` | id, name, **category**, selling_price | `category`: `food` \| `beverage` → **drives KOT routing** |
| `Recipe` | menu_item_id | 1:1 with MenuItem |
| `RecipeIngredient` | recipe_id, ingredient_id, quantity | stock deduction + cost calc |
| `Order` | id, table_id, status, created_at, total_paisa | status per state machine (§10) |
| `OrderItem` | order_id, menu_item_id, quantity, unit_price_paisa, category | category copied for routing/reporting |
| `Payment` | order_id, transaction_number, **plutus_ptrid**, status, mode, amount_paisa, rrn, approval_code, txn_log_id, client_id, store_id, raw_response | Pine Labs references; index `plutus_ptrid` & `transaction_number` |
| `Customer` | id, phone, type, first_seen, visit_count | analytics (optional for v1 - confirm) |
| `AuthCredential` | id, **scope**, user_id, password_hash | `scope`: `dashboard` \| `menu_crud` (§8) |

**Compute, don't store stale copies:** recipe cost = Σ(recipe qty × ingredient cost); item profit = selling_price − recipe cost; net profit = revenue − ingredient cost − expenses.

---

## 6. High-level order lifecycle (the story)

Customer is seated → waiter selects the table on the web app → menu unlocks → waiter builds the order → on confirm, the order splits by category and KOT tickets print to the **kitchen** (food) and **beverage counter** (beverage) → waiter generates and prints the bill → payment is taken on the A910S (UPI QR / card / cash) → on success, a receipt prints, ingredient stock is deducted, the dashboard updates, and the table is released.

This lifecycle is Module 5. The payment leg is Pine Labs cloud (§9). Everything else is your backend + web app.

---

## 7. Module 5 - Order, KOT Routing & Payment (detailed)

### 7.1 Seating & tables
The floor has sections (**Indoor, Outdoor, Smoking**), each with numbered tables. Each table has a live status (`free` / `occupied` / `kot_sent` / `billed`) shown on the dashboard.

### 7.2 Order entry (web app)
1. Waiter taps a table in a section → backend creates an `Order` (status `OPEN`), sets `Table.status = occupied`, menu unlocks.
2. Waiter adds `MenuItem`s + quantities → `OrderItem`s saved.
3. Waiter confirms the order.

### 7.3 KOT routing
On confirm, the backend splits `OrderItem`s by `MenuItem.category` and prints a ticket per station:
- **Food → Kitchen printer**
- **Beverage → Beverage Counter printer**

Each ticket shows table number, items, quantities. `Table.status = kot_sent`.

> **Printers are separate physical devices.** Kitchen and beverage counter are different locations, so use **separate network/Bluetooth thermal printers per station**, driven from the backend behind a `PrinterService` interface (mock that logs tickets now). The A910S built-in printer is for the **customer receipt/charge slip only**, not KOT. Confirm physical printer setup with the client.

### 7.4 Bill generation
Waiter generates the bill: itemised list (qty, price), total, table number, timestamp. Printable. `Table.status = billed`.

### 7.5 Payment (Pine Labs A910S)
Backend calls **UploadBilledTransaction** with the amount (paisa) and `AllowedPaymentMode = "1|2|10"` (Card | Cash | UPI). Pine Labs returns a **PTRID**; the A910S settles it. **The UPI QR is generated by the terminal**, not your app. Result comes back via **Post Back webhook** and/or **GetStatus** polling. Full detail in the integration master; summary in §9.

### 7.6 Completion (atomic, idempotent)
On confirmed success: `Order.status = PAID`, save `Payment` (mode/RRN/txnLogId/PTRID), **deduct ingredient stock** per recipe, **push dashboard update** (today's sales/profit, pending orders), **release the table** to `free`, print receipt.

### 7.7 Worked example
Table 4 (Indoor) → 1× Croissant (food) + 1× Iced Coffee (beverage) → KOT: Croissant→Kitchen, Iced Coffee→Beverage Counter → bill ₹250 → pay by UPI QR/card/cash → receipt → stock deducted, dashboard updated, table released.

---

## 8. Module 9 - Authentication (two credentials, no roles)

There are **no role-based permissions.** Exactly two credential sets, each a `user_id` + `password` stored in `AuthCredential` by `scope`:

1. **Dashboard access** (`scope = dashboard`) - required to open/operate the dashboard.
2. **Menu CRUD** (`scope = menu_crud`) - a **separate** credential. Clicking **Add / Edit / Delete Menu** opens a popup asking for these; the action proceeds only if correct (per-action re-verification, not a session role).

Hash passwords (bcrypt/argon2). No Super Admin/Manager/Cashier tiers - that was removed.

---

## 9. Pine Labs A910S - cloud integration (summary)

**Model:** the A910S is only the payment terminal; your web app is not on the device. Your **backend** talks to Pine Labs cloud over HTTPS; the bill and the payment are linked by a **PTRID**.

**Four operations (full spec in companion doc):**

| Need | Call | In | Out |
|---|---|---|---|
| Create payable bill | **UploadBilledTransaction** | `TransactionNumber` (your unique id), `Amount` (paisa), `AllowedPaymentMode` (`"1\|2\|10"`), `ClientId` (terminal), `StoreId`, `MerchantID`, `SecurityToken` | `ResponseCode` (0=ok), `PlutusTransactionReferenceID` (PTRID) |
| Check result | **GetStatus** | PTRID (+ store/client) | `ResponseCode`, `TransactionData[]` - **parse by `Tag`, never index** |
| Cancel open txn | **CancelTransactionForced** | PTRID, Amount | `ResponseCode` |
| Pushed result | **Post Back URL** (webhook) | Pine Labs → you | urlencoded, comma-joined `key=value`; **re-verify via GetStatus** |

**Non-negotiables:** success = `ResponseCode: 0`; amounts in paisa; `TransactionNumber` unique and mapped to PTRID; parse `TransactionData` by tag; all calls from backend; save PTRID the instant Upload returns; use `AutoCancelDurationInMinutes` for abandoned bills; cancellation only until PIN entry (UPI auto-reverses if cancelled after paying).

**Abstraction:** wrap all of this behind `PaymentProvider` (`charge` → Upload, `status` → GetStatus, `cancel` → Force Cancel; webhook confirms via `status`). Ship `MockPaymentProvider` now; implement `PineLabsCloudProvider` when UAT creds arrive. Order/KOT/dashboard logic never changes.

**Payment-mode codes used:** `1` Card · `2` Cash · `10` UPI Sale · `11` UPI Bharat QR.

---

## 10. Order + payment state machine

```
OPEN ──confirm order (KOT printed)──► KOT_SENT ──generate bill──► BILLED
BILLED ──UploadBilledTransaction ok (PTRID saved)──► AWAITING_PAYMENT
AWAITING_PAYMENT ──GetStatus approved──► PAID
      └─ PAID triggers (once, idempotent): stock deduction, revenue, dashboard push, table → free, receipt
AWAITING_PAYMENT ──declined / timeout──► PAYMENT_FAILED ──retry──► AWAITING_PAYMENT
AWAITING_PAYMENT ──cancel (before PIN)──► CANCELLED
```

Only the **PAID** transition recognises revenue and deducts stock, and it must guard on `status != PAID`.

---

## 11. Real-time dashboard

- Backend emits events on: order paid, stock change / low-stock, table status change, pending-order change.
- Clients (waiter app + manager dashboard) subscribe via **websocket**; **polling** is an acceptable fallback.
- Dashboard tiles (SRS Module 10): today's sales, today's profit, low-stock items, top seller, most-visited area, peak hour, pending orders, inventory value, live table statuses.

---

## 12. Cross-cutting requirements (non-functional)

- **Idempotency:** webhook + poll may both fire - finalize once.
- **Reconciliation:** scheduled job re-checks any `AWAITING_PAYMENT` order past a threshold via GetStatus; store `RRN` + `TransactionLogId` to match Pine Labs settlement reports.
- **Security:** backend-only secrets; HTTPS webhook; validate/verify callbacks before acting on money; passwords hashed.
- **Observability:** structured logs for every Pine Labs call and KOT print; alert on repeated failures.
- **Resilience / offline:** define behavior if the terminal or network drops mid-payment (rely on PTRID + GetStatus to resolve; never auto-retry a charge blindly). Confirm desired offline ordering behavior with client (open item).

---

## 13. Build plan (milestones, in dependency order)

Each milestone is independently runnable/testable. Review after each before proceeding.

1. **M0 - Repo onboarding & foundations.** Inventory the codebase; set up local dev; confirm DB; write the gap analysis (SRS module → exists? → missing). Establish data model (§5); seed sections/tables/terminals.
2. **M1 - Inventory (Mod 1).** Ingredient CRUD, stock updates, low-stock alerts, expiry tracking.
3. **M2 - Recipes & costing (Mod 2, 3).** Recipes, auto cost recalculation, menu pricing, profit; wire auto stock deduction hook (used in M4).
4. **M3 - Menu management + Auth (Mod 4-menu, 9).** Menu CRUD guarded by the menu-CRUD credential popup; dashboard-access credential.
5. **M4 - Order + KOT + bill (Mod 5, minus payment).** Tables/sections, order entry, category split, **KOT routing behind `PrinterService` (mock)**, bill generation. Payment via **`MockPaymentProvider`** end-to-end. **Ship the whole flow here without Pine Labs.**
6. **M5 - Dashboard (Mod 10) + Sales (Mod 4).** Real-time tiles, table statuses, persisted sales.
7. **M6 - Pine Labs cloud (real).** In parallel with M1–M5, complete onboarding/UAT. Then implement `PineLabsCloudProvider` (Upload/GetStatus/Cancel) + `/webhooks/pinelabs`; run the UAT test matrix from the integration master; swap mock → real.
8. **M7 - Analytics & P&L (Mod 6, 7, 8).** Area + customer analytics, profit trends.
9. **M8 - Reports (Mod 11).** Daily/weekly/monthly + PDF/Excel/CSV/print export.
10. **M9 - Hardening.** Reconciliation job, idempotency tests, offline handling, observability, production cutover.

---

## 14. Open items to resolve (owners: PM + client + Pine Labs)

- [ ] Exact Pine Labs **endpoint paths** for Upload & GetStatus, and the **production host** (spec gives UAT host + force-cancel path only).
- [ ] Final `MerchantID`, `SecurityToken`, `StoreId`, and `ClientId` per A910S; which payment modes are enabled.
- [ ] Post Back URL support + exact callback format/auth for this account.
- [ ] **Number of A910S terminals** (drives ClientId/StoreId routing) and whether zero-click auto-routing is enabled.
- [ ] Separate physical **KOT printers** at kitchen + beverage counter - confirmed models/connectivity.
- [ ] **Expense** and **Customer** modules in v1? (Net Profit accuracy depends on expenses; customer analytics depends on capturing customer data.)
- [ ] **Area list mismatch:** SRS Module 7 lists 5 areas (Indoor, Outdoor, Smoking, Rooftop, Lounge) but the workflow uses 3 sections - align to which set?
- [ ] Offline behavior for ordering/payment on connectivity loss.

---

## 15. Getting started (day-one checklist)

1. Read this doc, then `Smart_Cafe_SRS.docx` (Modules 1–11), then `PINELABS_INTEGRATION_MASTER.md`.
2. Explore the existing repo; produce the gap analysis (M0).
3. Stand up local dev; run existing tests; confirm DB connectivity.
4. Build milestone by milestone (§13), mocks first. After each: summarise changes, how to run/test, and get review.
5. Keep payment and printers behind mock interfaces until real access exists.
6. Don't build anything outside the SRS without raising it.

---

## 16. Definition of done (per feature)

- Behaves per SRS + the flows in §7–§10.
- Writes through the backend; no device-local authoritative state.
- Idempotent wherever money or stock is touched.
- Uses the mockable interface, not hard-coded SDK/HTTP.
- Dashboard reflects the change in real time.
- Has happy-path + at least one failure-path test.

---

## 17. Quick reference (pin this)

- **Backend is the source of truth; A910S is only the payment terminal.**
- **PTRID** joins your order to the payment - save it the moment Upload returns.
- **Success = `ResponseCode: 0`. Amounts = paisa (integer). Parse `TransactionData` by `Tag`.**
- **KOT:** food→Kitchen printer, beverage→Beverage Counter printer (separate devices, backend-driven). Receipt→A910S built-in.
- **Auth:** two credentials - dashboard access + menu-CRUD popup. No roles.
- **AllowedPaymentMode `"1|2|10"`** = Card, Cash, UPI in one flow.
- **Everything external is behind a mockable interface.** Build against mocks first.
