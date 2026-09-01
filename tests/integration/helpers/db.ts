// Integration-test harness.
//
// Runs against a REAL Postgres so the things that only exist in the database -
// transactions, row locks, partial unique indexes, the FOR UPDATE serialization
// in finalizeApprovedPayment - are actually exercised. Unit tests cannot prove
// any of that.
//
// Point TEST_DATABASE_URL at a throwaway database and the suite runs:
//   docker run --rm -e POSTGRES_PASSWORD=test -p 55432:5432 -d postgres:16-alpine
//   TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/postgres npm test
//
// Without it the integration suites skip (and say so) rather than failing.

import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
export const hasTestDatabase = TEST_DATABASE_URL.length > 0

let sql: postgres.Sql | null = null

export function testDb(): postgres.Sql {
  if (!sql) {
    sql = postgres(TEST_DATABASE_URL, { max: 5, onnotice: () => {} })
  }
  return sql
}

export async function closeTestDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 })
    sql = null
  }
}

function readSql(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

/**
 * Rebuilds the schema from the same files a real deployment uses, so a drift
 * between docker/schema.sql and the migrations shows up as a test failure.
 */
export async function resetSchema(): Promise<void> {
  const db = testDb()
  await db.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  await db.unsafe(readSql('docker', 'schema.sql'))
}

/** Minimal fixture: one cafe, one section, one table, one terminal. */
export interface Fixture {
  cafeId: string
  sectionId: number
  tableId: string
  clientId: string
  menuItemId: string
}

export async function seedFixture(): Promise<Fixture> {
  const db = testDb()
  const cafeId = '11111111-1111-1111-1111-111111111111'

  await db`
    INSERT INTO cafes (id, name, slug, settings, is_active)
    VALUES (${cafeId}, 'Test Cafe', 'test-cafe',
            ${db.json({ tax_percent: 5, service_charge_percent: 0, accept_cash: true, accept_upi: true, accept_card: true, show_social_proof: false, languages: ['en'] })},
            true)
    ON CONFLICT (id) DO NOTHING
  `

  const [section] = await db`
    INSERT INTO sections (name, sort_order) VALUES ('Main', 1) RETURNING id
  `
  const [table] = await db`
    INSERT INTO tables (cafe_id, number, section_id, status, is_active)
    VALUES (${cafeId}, ${Math.floor(Math.random() * 100000)}, ${section.id}, 'free', true)
    RETURNING id
  `
  await db`
    INSERT INTO terminals (client_id, label, section_id) VALUES ('55', 'Counter A910S', ${section.id})
    ON CONFLICT DO NOTHING
  `
  const [category] = await db`
    INSERT INTO menu_categories (cafe_id, name, sort_order, is_active)
    VALUES (${cafeId}, 'Coffee', 1, true) RETURNING id
  `
  const [item] = await db`
    INSERT INTO menu_items (cafe_id, category_id, name, price, category, is_available)
    VALUES (${cafeId}, ${category.id}, 'Flat White', 250, 'beverage', true)
    RETURNING id
  `

  return {
    cafeId,
    sectionId: section.id as number,
    tableId: table.id as string,
    clientId: '55',
    menuItemId: item.id as string,
  }
}

export interface SeededOrder {
  orderId: string
  paymentId: string
  totalPaisa: number
}

/** An order sitting in AWAITING_PAYMENT with an initiated payment - the state every hard case starts from. */
export async function seedAwaitingPaymentOrder(fx: Fixture, totalPaisa = 25000): Promise<SeededOrder> {
  const db = testDb()
  const [order] = await db`
    INSERT INTO orders (cafe_id, table_id, order_number, status, pos_status, subtotal, total_amount, total_paisa)
    VALUES (${fx.cafeId}, ${fx.tableId}, ${'ORD-' + Math.floor(Math.random() * 1e9)}, 'confirmed', 'AWAITING_PAYMENT',
            ${totalPaisa / 100}, ${totalPaisa / 100}, ${totalPaisa})
    RETURNING id
  `
  await db`
    INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, subtotal, category, status)
    VALUES (${order.id}, ${fx.menuItemId}, 'Flat White', 250, 1, 250, 'beverage', 'pending')
  `
  const [payment] = await db`
    INSERT INTO payments (order_id, transaction_number, plutus_ptrid, status, mode, amount_paisa, client_id, store_id)
    VALUES (${order.id}, ${'TXN-' + Math.floor(Math.random() * 1e9)}, ${'PTRID-' + Math.floor(Math.random() * 1e9)},
            'initiated', 'CARD', ${totalPaisa}, ${fx.clientId}, '9988')
    RETURNING id
  `
  return { orderId: order.id as string, paymentId: payment.id as string, totalPaisa }
}
