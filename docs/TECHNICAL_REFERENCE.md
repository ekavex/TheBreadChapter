# Technical Reference — The Bread Chapter

Complete architecture, schema, and API reference for the Smart Cafe Management System.

---

## Overview

The Bread Chapter is a full-stack cafe management platform built for single-tenant deployment. It covers the full order lifecycle: table-side digital menu → POS order creation → kitchen display → billing → payment → analytics.

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Browser   │  │   Browser   │  │   Kitchen   │  │  Pine Labs  │
│ Dashboard/  │  │  Customer   │  │   Display   │  │   Webhook   │
│    POS      │  │    Menu     │  │  (polling)  │  │             │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                 │
       └────────────────┴────────────────┴─────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Next.js 14 App      │
                    │  API Routes · RSC ·     │
                    │  Middleware (RBAC)       │
                    └──────────┬──────────────┘
                               │                    ┌──────────────┐
                    ┌──────────▼──────────┐         │   Thermal    │
                    │   PostgreSQL 16     │         │   Printers   │
                    │   (Docker volume)   │         │ USB/BT/IP    │
                    └─────────────────────┘         └──────────────┘
```

All server-side logic runs in Next.js API routes — no separate backend service. The database is accessed directly via the `postgres` npm package (no ORM). Supabase has been fully removed.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 | App Router, React Server Components |
| Language | TypeScript 5 | Strict mode |
| Database | PostgreSQL 16 | via `postgres` npm (tagged-template SQL) |
| Styling | Tailwind CSS 3 | Custom design tokens |
| Auth | Custom JWT | `jose` + `bcryptjs`, `sc_session` cookie |
| Date utils | date-fns 3 | |
| Payment | Pine Labs Cloud EDC | Falls back to mock when unconfigured |
| Printing | Thermal ESC/POS | USB / Bluetooth / Network |
| Container | Docker | Multi-stage build, standalone Next.js output |

### Key Design Decisions

| Decision | Rationale |
|---|---|
| No ORM | Tagged-template SQL via `postgres` npm — full query control, no N+1 leaks |
| Server Components for pages | Dashboard, POS, menu pages query DB at render time; no client-side fetch on load |
| Polling instead of websockets | Kitchen display and order tracker use 4–5 s polling; removes realtime dependency |
| Flat session tokens | JWT signed with `jose`; no NextAuth dependency |
| `force-dynamic` on all DB pages | Prevents Next.js static generation from hitting the DB at build time |
| `::uuid[]` explicit casts | PostgreSQL 18 has no implicit `text→uuid` cast; `sql.array()` must be cast explicitly |

---

## Directory Structure

```
src/
├── app/
│   ├── (dashboard)/dashboard/   # Admin/manager dashboard pages
│   │   ├── analytics/
│   │   ├── inventory/
│   │   ├── menu-manager/
│   │   ├── orders/
│   │   └── reports/
│   ├── api/                     # All REST endpoints
│   │   ├── auth/
│   │   ├── pos/
│   │   ├── menu/
│   │   ├── analytics/
│   │   ├── ingredients/
│   │   ├── orders/
│   │   ├── reports/
│   │   └── webhooks/pinelabs/
│   ├── pos/                     # POS operator UI
│   ├── kitchen/                 # Kitchen display (polling)
│   ├── menu/[tableId]/          # Customer-facing digital menu
│   └── order/[orderId]/         # Customer order tracker (public)
├── components/                  # Shared UI components
├── lib/
│   ├── auth/                    # Session, credentials, RBAC guards
│   ├── db/index.ts              # postgres singleton + type overrides
│   ├── hooks/                   # useKitchenOrders, useOrderStatus (polling)
│   ├── payment/                 # Pine Labs + Mock providers
│   ├── printer/                 # ESC/POS thermal print drivers
│   ├── types/                   # TypeScript types + generated DB types
│   ├── analytics.ts             # P&L, area, customer analytics
│   ├── dashboard.ts             # Today's live metrics
│   └── reports.ts               # Exportable period reports
└── docker/schema.sql            # Full DB schema (auto-applied on first start)
```

---

## Database Schema

17 tables. All primary keys are `uuid` with `gen_random_uuid()` default. All timestamps are `timestamptz` returned as ISO strings. Plain `date` columns (e.g. `expiry_date`) are returned as `YYYY-MM-DD` strings.

| Table | Purpose | Key columns |
|---|---|---|
| `cafes` | Cafe profile and settings | `id`, `slug`, `settings jsonb` |
| `sections` | Seating areas (Indoor, Terrace, etc.) | `cafe_id`, `sort_order` |
| `tables` | Physical tables with shape/position | `section_id`, `number`, `status`, `shape` |
| `menu_categories` | Category groupings for the menu | `cafe_id`, `sort_order`, `is_active` |
| `menu_items` | Individual dishes and drinks | `category_id`, `price`, `cost_price_paisa`, `is_available` |
| `ingredients` | Inventory items with stock levels | `current_stock`, `low_stock_threshold`, `expiry_date` |
| `recipes` | Maps a menu item to its ingredients | `menu_item_id` |
| `recipe_ingredients` | Ingredient quantities per recipe | `recipe_id`, `ingredient_id`, `quantity` |
| `orders` | Core order record | `cafe_id`, `table_id`, `status`, `pos_status`, `payment_status`, `total_amount` |
| `order_items` | Line items per order | `order_id`, `menu_item_id`, `quantity`, `status`, `customisation` |
| `kot_tickets` | Kitchen Order Tickets sent to printer | `order_id`, `station`, `printed_at` |
| `payments` | Payment transaction log | `order_id`, `provider`, `status`, `amount` |
| `customers` | Optional customer records (by phone) | `phone`, `name`, `visit_count` |
| `stock_transactions` | Inventory movement log | `ingredient_id`, `type`, `quantity`, `delta` |
| `users` | Staff user accounts | `role`, `display_name` |
| `auth_credentials` | Hashed passwords for users | `user_id`, `password_hash` |
| `staff_notifications` | In-app notification feed | `cafe_id`, `action`, `is_read` |
| `terminals` | POS terminal registrations | `cafe_id`, `name` |

### Enums & Types

| Name | Values |
|---|---|
| `order_status` | `pending` · `confirmed` · `making` · `ready` · `served` · `completed` · `cancelled` |
| `pos_status` *(text column)* | `OPEN` · `KOT_SENT` · `BILLED` · `AWAITING_PAYMENT` · `PAID` · `PAYMENT_FAILED` · `CANCELLED` |
| `payment_status` | `pending` · `paid` · `refunded` · `failed` |
| `payment_method` | `cash` · `card` · `upi` |
| `table_status` | `available` · `occupied` · `reserved` · `cleaning` |
| `menu_item_category` | `food` · `beverage` |
| `stock_txn_type` | `purchase` · `sale_deduction` · `waste` · `adjustment` |

> **PostgreSQL 18 note** — no implicit `text → uuid` or `text → enum` cast exists. All `sql.array()` calls must use explicit casts: `::uuid[]` for UUID arrays, `::order_status[]` for enum arrays.

---

## API Routes

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login with `userId + password`. Sets `sc_session` cookie. |
| `POST` | `/api/auth/logout` | Session | Clears session cookie. |
| `POST` | `/api/auth/verify-menu-credentials` | Public | Verifies a menu-access PIN for gated menus. |

### POS

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pos/tables` | All tables with current status and section |
| `PATCH` | `/api/pos/tables/[id]` | Update table status |
| `GET` | `/api/pos/orders` | Active orders for a table or today's full list |
| `POST` | `/api/pos/orders` | Create a new order |
| `GET` | `/api/pos/orders/[id]` | Fetch single order with items and table |
| `POST` | `/api/pos/orders/[id]/items` | Add items to an open order |
| `PATCH` | `/api/pos/orders/[id]/items/[itemId]` | Update quantity or remove an item |
| `POST` | `/api/pos/orders/[id]/kot` | Fire KOT — prints to kitchen/beverage thermal printer |
| `POST` | `/api/pos/orders/[id]/bill` | Generate bill, set `pos_status → BILLED` |
| `POST` | `/api/pos/orders/[id]/pay` | Initiate payment (Pine Labs or mock) |
| `POST` | `/api/pos/orders/[id]/occupy` | Mark table as occupied when order opened |
| `POST` | `/api/pos/orders/[id]/cancel` | Cancel order and release table |
| `POST` | `/api/webhooks/pinelabs` | Pine Labs payment callback — finalizes order on approval |
| `GET` | `/api/order/[orderId]` | **Public** — customer order status tracker (no auth required) |

### Menu & Inventory

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/menu` | Full menu — categories with nested items |
| `POST` | `/api/menu/categories` | Create category |
| `PATCH` / `DELETE` | `/api/menu/categories/[id]` | Update or delete category |
| `POST` | `/api/menu/items` | Create menu item |
| `PATCH` / `DELETE` | `/api/menu/items/[id]` | Update or delete menu item |
| `GET` | `/api/ingredients` | All ingredients sorted by name |
| `POST` | `/api/ingredients` | Create ingredient |
| `PATCH` / `DELETE` | `/api/ingredients/[id]` | Update or delete ingredient |
| `POST` | `/api/ingredients/[id]/stock` | Adjust stock level (creates stock transaction) |
| `GET` | `/api/ingredients/low-stock` | Ingredients at or below `low_stock_threshold` |
| `GET` | `/api/ingredients/expiring` | Ingredients expiring within 3 days |
| `GET` / `POST` | `/api/recipes` | Get recipe by `menuItemId` or create recipe |
| `PATCH` / `DELETE` | `/api/recipes/[id]` | Update or delete recipe |

### Analytics & Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Today's live metrics — sales, pending orders, top seller, section counts |
| `GET` | `/api/orders` | Orders by date or kitchen view (`?kitchen=true`) |
| `GET` | `/api/analytics/profit-loss` | P&L bucketed by `daily / weekly / monthly / yearly` |
| `GET` | `/api/analytics/area` | Visitors, popular items, peak hour — by seating section |
| `GET` | `/api/analytics/customers` | Customer count, new vs repeat, most ordered item, avg bill |
| `GET` | `/api/reports/[range]` | Full report for `daily / weekly / monthly` window |
| `GET` | `/api/reports/[range]/export` | Downloads report as CSV |
| `GET` | `/api/notifications` | In-app alerts — low stock, expiring items, stuck orders |

### Admin

| Method | Path | Role Required | Description |
|---|---|---|---|
| `GET` | `/api/admin/users` | admin | List all staff users |
| `POST` | `/api/admin/users` | admin | Create user with role and password |
| `PATCH` | `/api/admin/users/[id]` | admin | Update display name, role, or password |
| `DELETE` | `/api/admin/users/[id]` | admin | Remove user account |
| `GET` | `/api/tables` | manager | Tables for layout management |

---

## Roles & Permissions

| Feature | Admin | Manager | Staff |
|---|---|---|---|
| POS (floor plan, orders, KOT, bill) | ✓ | ✓ | ✓ |
| Dashboard overview | ✓ | ✓ | ✓ read-only |
| Menu manager | ✓ | ✓ | ✓ read-only |
| Kitchen display | ✓ | ✓ | ✓ |
| Inventory management | ✓ | ✓ | — |
| Orders history | ✓ | ✓ | — |
| Analytics & reports | ✓ | ✓ | — |
| Staff notifications | ✓ | ✓ | — |
| Admin panel (user management) | ✓ | — | — |

Role is stored in the session JWT and checked in both the middleware (page access) and individual API route handlers. The middleware redirects blocked routes to `/dashboard`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | **required** | Password for the `breaduser` DB account. Used by Docker Compose and baked into `DATABASE_URL`. |
| `AUTH_SESSION_SECRET` | **required** | Signs the `sc_session` JWT. Generate with `openssl rand -hex 32`. Rotate to invalidate all sessions. |
| `NEXT_PUBLIC_APP_URL` | **required** | Public base URL (e.g. `https://pos.breadchapter.in`). Used for QR code generation and payment callbacks. |
| `NEXT_PUBLIC_APP_NAME` | optional | Cafe display name shown in the UI. Default: *The Bread Chapter*. |
| `APP_PORT` | optional | Host port Docker maps to container `:3000`. Default: `3000`. |
| `MOCK_PAYMENT_OUTCOME` | optional | When Pine Labs is unconfigured, forces mock result: `approved` / `declined` / `cancelled`. |
| `PINELABS_MERCHANT_ID` | optional | Pine Labs merchant identifier. Leave blank to use mock payment. |
| `PINELABS_SECURITY_TOKEN` | optional | Pine Labs secret. **Server-side only — never expose client-side.** |
| `PINELABS_STORE_ID` | optional | Pine Labs store/terminal identifier. |
| `PINELABS_BASE_URL` | optional | Pine Labs API base URL. UAT default; swap for production URL when live. |
| `PRINTER_KITCHEN_IP` | optional | Network thermal printer IP for kitchen station. |
| `PRINTER_BEVERAGE_IP` | optional | Network thermal printer IP for beverage station. |
| `PRINTER_KITCHEN_BT_MAC` | optional | Bluetooth MAC address for kitchen printer. |
| `PRINTER_KITCHEN_BT_DEVICE` | optional | USB device path, e.g. `/dev/usb/lp1`. |
| `PRINTER_BEVERAGE_BT_MAC` | optional | Bluetooth MAC address for beverage printer. |
| `PRINTER_BEVERAGE_BT_DEVICE` | optional | USB device path for beverage printer. |
