# Café POS - KOT Printing & Pine Labs Payment Architecture

## Corrections made to the original draft

Before the full document, here's what was fixed:

1. **Pine Labs was drawn as if it sat downstream of the print service** in the hardware diagram. Payment and KOT printing are independent systems that both hang off your backend - they don't talk to each other. The diagram below shows them as two separate branches instead of one chain.
2. **"Chrome cannot access USB devices" is not quite accurate.** Chrome does support WebUSB and Web Bluetooth APIs. The reason you still shouldn't rely on browser-direct printing isn't that it's impossible - it's that WebUSB requires an explicit per-device user permission prompt (no silent background access), only works over HTTPS with specific device filters, doesn't survive across sessions reliably, and most 58mm ESC/POS printers don't expose the kind of interface WebUSB expects cleanly. A local Node.js service is still the right call, just for reliability/UX reasons, not because it's technically impossible.
3. **Order status list was missing an "awaiting payment" state.** The doc later says the backend "marks the order as awaiting payment" after calling Pine Labs, but the status enum only listed `OPEN / PREPARING / READY / COMPLETED`. Added `AWAITING_PAYMENT` and `PAID`/`CANCELLED` so the states referenced in the payment flow actually exist in the schema.
4. **`printed` as a single boolean on `order_items` breaks with two printers.** If Food and Beverage are different printers (as recommended), a single `printed` flag can't distinguish "printed to kitchen" from "printed to bar." Changed this to a `kot_prints` table keyed by `order_item_id` + `printer_id`, so reprint/add-on logic works correctly per station.
5. **Pine Labs API method names (`UploadBilledTransaction`, `GetStatus`) are taken as given from your uploaded guide** - I don't have that source document in this conversation, so I haven't independently verified those against current Pine Labs documentation. Confirm the exact endpoint names, request shape, and webhook payload against your merchant's current Pine Labs Cloud integration docs before building against them.
6. Added a short **reliability/error-handling** section, since a print pipeline with two independent stations and an unattended service is the most common source of real-world café POS bugs (offline printer, paper-out, service crash) and the original draft didn't cover it.

Everything else in the original structure (separation of concerns, ESC/POS usage, USB/Bluetooth/LAN handling, reprint logic, recommended stack) was accurate and is kept as-is below.

---

## 1. System Boundary

Two independent systems, joined only at your backend:

- **Pine Labs A910S** - payment only. Your app never runs on the terminal. All communication goes through your backend via Pine Labs Cloud APIs.
- **KOT printing** - entirely your responsibility. Pine Labs does not print kitchen tickets. Your application routes order items to the correct kitchen/bar printers.

## 2. Hardware Architecture

```
                         Counter PC
                    (Next.js + Chrome)
                            │
                            ▼
                  Next.js Backend (API)
                            │
                            ▼
                Supabase PostgreSQL Database
                            │
                  Supabase Realtime
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
      Food Print Service          Beverage Print Service
        (Node.js)                       (Node.js)
              │                           │
        USB / Bluetooth              USB / Bluetooth
              │                           │
              ▼                           ▼
      58mm Kitchen Printer         58mm Beverage Printer


   Backend (independent branch, triggered on "Generate Bill")
              │
              ▼
       Pine Labs Cloud API
              │
              ▼
       Pine Labs A910S Device
```

Payment and printing are two separate branches off the backend - not a chain. A failed or slow print job should never block payment, and vice versa.

## 3. Order Flow Example

Customer order:

```
Table: 5
2 Veg Burger        (Burger note: Extra Cheese)
1 French Fries
3 Cold Coffee        (Coffee note: Less Sugar)
```

`POST /orders` → backend writes:

**orders**
```
id, table_no, status, created_at
```

**order_items**
```
id, order_id, product_id, qty, notes, category, printed_status
```

Example rows:
```
Veg Burger   → category: FOOD
French Fries → category: FOOD
Cold Coffee  → category: BEVERAGE
```

Supabase Realtime fires. Each print service filters by its own category:

- Food Listener receives: Veg Burger, French Fries
- Beverage Listener receives: Cold Coffee

Each listener prints only its category.

## 4. Database Schema (revised)

```
orders
  id
  table_no
  status            -- OPEN | PREPARING | READY | AWAITING_PAYMENT | PAID | COMPLETED | CANCELLED
  created_at

order_items
  id
  order_id
  product_id
  qty
  notes
  category          -- FOOD | BEVERAGE
  created_at

kot_prints                     -- new: replaces single `printed` boolean
  id
  order_item_id
  printer_id
  printed_at
  reprint_of        -- nullable, references kot_prints.id for reprint chains

printers
  id
  name
  type              -- USB | BLUETOOTH | LAN
  category          -- FOOD | BEVERAGE
  connection_address
  status            -- ONLINE | OFFLINE | ERROR
```

An item is "printed" if a row exists in `kot_prints` for that `(order_item_id, printer_id)` pair. This correctly supports multiple printers and per-station reprints without ambiguity.

## 5. Printer Specification

Billing Buddy Power Printer: 58 mm, Bluetooth + USB, 90 mm/sec, thermal, **ESC/POS compatible**.

This means the printer accepts raw ESC/POS command bytes - not PDF, not HTML. Example logical sequence:

```
ESC init → Bold ON → Center align → "KITCHEN" → Bold OFF
→ Item lines → Qty → Cut paper
```

## 6. Connectivity Options

**USB**
```
Next.js → Node Print Service → USB driver → Printer
```

**Bluetooth**
```
Node Print Service → RFCOMM (Windows maps to a COM port, e.g. COM5) → Printer
```

**LAN**
```
Node Print Service → TCP socket → Port 9100 → Printer
```

LAN/Ethernet printers are generally preferred in commercial deployments because they don't depend on OS-level drivers or pairing state - worth considering for BEVERAGE/FOOD stations if you scale beyond one counter.

## 7. Why Not Browser-Direct Printing

`window.print()` opens a print preview dialog, targets A4/Letter paper, and requires manual printer selection each time - unsuitable for POS.

WebUSB/Web Bluetooth exist in Chrome but require a user-initiated permission grant per device per origin, don't run unattended, and add fragility for a background kitchen workflow. A locally installed Node.js service (running as a Windows service, started at boot, listening on `localhost:3005/print`) is the practical choice - not because the browser is technically incapable, but because it's the wrong tool for unattended, always-on printing.

```
Next.js app → POST http://localhost:3005/print
Body: { category: "FOOD", order_id: 102, items: [...] }
→ Node service writes ESC/POS bytes to the printer
```

## 8. KOT Format

```
----------------------------
SUNRISE CAFE
Kitchen Order Ticket
----------------------------
Order #125        Table: 6
Time: 6:42 PM
----------------------------
2 x Veg Burger
1 x Fries
----------------------------
Burger:
 • Extra Cheese
----------------------------
Operator: Kalash
----------------------------
THANK YOU
----------------------------
```

Beverage ticket (separate printer):

```
----------------------------
BEVERAGE SECTION
Order #125
----------------------------
3 x Cold Coffee
Less Sugar
----------------------------
```

Recommended full ticket contents: cafe name, KOT number, order number, table number, token number, date/time, cashier name, kitchen section, item name/qty/variant/price (optional), special requirements (extra cheese, no onion, extra ice, less sugar), remarks (parcel / dine-in / take-away), optional QR, cut paper.

## 9. Reprint & Add-On Logic

- **Reprint**: cashier triggers `force=true` on the print endpoint, which inserts a new `kot_prints` row referencing the original via `reprint_of`, regardless of whether a print already exists. Never mutate history - always insert, don't overwrite.
- **Add-on orders**: if Burger already has a `kot_prints` row for the kitchen printer and Coffee is added 15 minutes later, only Coffee prints - because only Coffee lacks a row in `kot_prints` for its target printer.

## 10. Printer Mapping Table (example)

```
id  name       type       category    connection
1   Kitchen    USB        FOOD        USB001
2   Beverage   Bluetooth  BEVERAGE    00:1B:44:11:3A:B7
```

## 11. Reliability & Error Handling (added)

The original draft didn't cover failure modes, which are where most real-world print pipeline bugs live:

- **Printer offline / paper out**: the Node service should catch write failures, mark the printer `ERROR` in the `printers` table, and surface this on the counter UI immediately - don't let a failed print silently disappear.
- **Print service crash/restart**: on startup, the service should query for order items with no matching `kot_prints` row for its printer and print those (catch-up), rather than relying solely on the live Realtime stream.
- **Duplicate Realtime events**: Supabase Realtime can occasionally redeliver events; the print service must be idempotent - check `kot_prints` before printing, not just react to the event.
- **Pine Labs webhook missed**: don't rely solely on the webhook to confirm payment - poll `GetStatus` (or your confirmed equivalent) as a fallback if no webhook arrives within a short timeout, since network drops between Pine Labs and your server are the most common cause of "payment succeeded but order stuck as AWAITING_PAYMENT."

## 12. Pine Labs Payment Flow

```
Order Created → Print KOT → Customer asks for bill
   → Backend calls UploadBilledTransaction (verify exact name against current docs)
   → receives PTRID, order.status = AWAITING_PAYMENT
   → Pine Labs Cloud → A910S terminal → customer pays
   → GetStatus (poll) or webhook confirms
   → order.status = PAID
```

All secrets (`MerchantID`, `SecurityToken`) stay server-side only - never sent to the browser.

## 13. End-to-End Flow

```
Customer → Cashier → Create Order → Save to Supabase
   → Realtime event
        → Food items → Kitchen printer
        → Beverage items → Beverage printer
   → Chef starts cooking → Chef marks Ready
   → Cashier generates bill → Pine Labs payment
   → Payment success → Print customer receipt → Order closed
```

## 14. Recommended Production Stack

| Component          | Technology                                                    |
|---------------------|----------------------------------------------------------------|
| Frontend POS        | Next.js                                                        |
| Backend API          | Next.js API Routes / Route Handlers                            |
| Database            | Supabase PostgreSQL                                            |
| Live updates        | Supabase Realtime                                               |
| KOT print service    | Node.js background service (Windows Service or Electron)       |
| Printer protocol    | ESC/POS                                                         |
| Kitchen printer     | Billing Buddy 58mm USB/Bluetooth (consider LAN as you scale)   |
| Payment             | Pine Labs Cloud Integration (A910S)                             |
| Customer receipt    | Same ESC/POS printer or a dedicated billing printer            |

## 15. Recommendation for Your Café

- **Counter PC**: runs the Next.js POS app.
- **One local Node.js print service** on the Windows machine connected to the printers - subscribes to Supabase Realtime, communicates with all printers over ESC/POS, and does catch-up printing on restart.
- **Two printers**: one mapped to `FOOD`, one to `BEVERAGE`.
- **Pine Labs A910S**: payments only, integrated through the backend, secrets server-side only.

This keeps payment and kitchen printing as cleanly separated, independently-failing systems - which is the same separation used in commercial restaurant POS platforms, and avoids a payment glitch ever blocking a kitchen ticket or vice versa.
