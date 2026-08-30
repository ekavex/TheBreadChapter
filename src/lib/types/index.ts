// ─── Database Types ──────────────────────────────────────────
// `Database` (and its Row/Insert/Update shapes) lives in database.generated.ts.
// DB access here is raw SQL via the `postgres` client (src/lib/db), not a
// PostgREST/Supabase client — there's no `.from(...)` query builder in this
// codebase, so no codegen step keeps that file in sync. Update it by hand
// after any migration that adds/renames/removes a column or table, then
// adjust the friendly aliases below if needed. Keep Row/Insert/Update as
// `type` aliases rather than `interface` for consistency with the rest of
// this file — no functional requirement forces it either way anymore.
import type { Database as GeneratedDatabase } from './database.generated'

export type Database = GeneratedDatabase
type Tables = Database['public']['Tables']
type Enums = Database['public']['Enums']

export type OrderStatus = Enums['order_status']
export type PaymentMethod = Enums['payment_method']
export type PaymentStatus = Enums['payment_status']
export type TableStatus = Enums['table_status']
export type MenuItemCategory = Enums['menu_item_category']
export type StockTxnType = Enums['stock_txn_type']

// CHECK-constrained TEXT columns, not real Postgres enums — codegen can't
// narrow these, so they stay hand-written.
export type PosStatus = 'OPEN' | 'KOT_SENT' | 'BILLED' | 'AWAITING_PAYMENT' | 'PAID' | 'PAYMENT_FAILED' | 'REQUIRES_VERIFICATION' | 'CANCELLED'
export type UserRole = 'admin' | 'manager' | 'staff'
export type KotStation = 'kitchen' | 'beverage_counter'
export type PaymentTxnStatus = 'initiated' | 'approved' | 'declined' | 'cancelled'

export type CafeSettings = {
  accept_cash: boolean
  accept_upi: boolean
  accept_card: boolean
  tax_percent: number
  service_charge_percent: number
  show_social_proof: boolean
  languages: string[]
}

export type Cafe = Omit<Tables['cafes']['Row'], 'settings'> & { settings: CafeSettings }

export type Section = Tables['sections']['Row']
export type Terminal = Tables['terminals']['Row']

export type Table = Tables['tables']['Row'] & {
  // Joined
  section?: Section
}

export type MenuCategory = Tables['menu_categories']['Row'] & {
  // Joined
  items?: MenuItem[]
}

export type MenuItemVariant = { label: string; price: number }

export type MenuItem = Omit<Tables['menu_items']['Row'], 'spice_level' | 'upsell_item_ids'> & {
  spice_level: 0 | 1 | 2 | 3
  upsell_item_ids: string[]
  variants?: MenuItemVariant[] | null
}

export type Ingredient = Tables['ingredients']['Row']
export type StockTransaction = Tables['stock_transactions']['Row']

export type Recipe = Tables['recipes']['Row'] & {
  // Joined
  ingredients?: RecipeIngredient[]
}

export type RecipeIngredient = Tables['recipe_ingredients']['Row'] & {
  // Joined
  ingredient?: Ingredient
}

export type Order = Omit<Tables['orders']['Row'], 'pos_status'> & {
  pos_status: PosStatus
  customer_note?: string | null
  // Joined
  items?: OrderItem[]
  table?: Table
}

export type Addon = {
  id: string
  cafe_id: string
  name: string
  price: number
  is_active: boolean
  sort_order: number
  created_at: string
}

export type OrderItemAddon = { id: string; name: string; price: number }

export type OrderItem = Tables['order_items']['Row'] & {
  addons_json?: OrderItemAddon[]
}

export type KotTicket = Omit<Tables['kot_tickets']['Row'], 'station' | 'items_json'> & {
  station: KotStation
  items_json: { name: string; quantity: number }[]
}

export type Payment = Omit<Tables['payments']['Row'], 'status'> & { status: PaymentTxnStatus }

export type AuthCredential = Omit<Tables['auth_credentials']['Row'], 'role'> & { role: UserRole }

// ─── Cart Types (client-side only, not in DB) ────────────────
export type CartItem = {
  menuItem: MenuItem
  quantity: number
  customisation?: string
}

export type Cart = {
  cafeId: string
  tableId: string
  tableNumber: number
  items: CartItem[]
}

// ─── API response types ──────────────────────────────────────
export type ApiResponse<T> = {
  data: T | null
  error: string | null
}

export type MenuPageData = {
  cafe: Cafe
  table: Table
  categories: MenuCategory[]
}
