# cafe-system/CLAUDE.md

## Project
Cafe web + automation system. Phase 1 — Next.js 14 + Supabase.
Multi-tenant: every table has a cafe_id. Never query without it.

## Commands
- npm run dev       — start dev server (port 3000)
- npm run build     — production build
- npm run lint      — ESLint check

## Supabase
- URL + keys in .env.local (copy from .env.local.example)
- Run migrations: supabase/migrations/001_initial_schema.sql
- Seed data: supabase/seed/demo_cafe.sql
- Demo cafe slug: sunrise-cafe, ID: 11111111-1111-1111-1111-111111111111

## Key URLs
- /menu/[tableNumber]?cafe=[slug]  ← customer QR landing page
- /kitchen                         ← kitchen display (tablet)
- /dashboard                       ← owner dashboard

## Code style
- TypeScript strict mode — no `any` unless commented why
- All DB queries go through src/lib/supabase/client.ts or server.ts
- Tailwind only — no inline styles, no CSS modules
- Server components fetch data; client components handle interaction

## Phase 1 still needs
- src/components/menu/MenuHeader.tsx
- src/components/menu/CategoryNav.tsx
- src/components/menu/CartBar.tsx
- src/app/order/[orderId]/page.tsx  (order tracking page)
- src/app/(dashboard)/dashboard/layout.tsx  (dashboard nav)