import { notFound, redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory, Table, Addon } from '@/lib/types'
import PosOrderClient from '../[orderId]/PosOrderClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New Order' }

export default async function NewOrderPage({ searchParams }: { searchParams: { tableId?: string } }) {
  const tableId = searchParams.tableId
  if (!tableId) notFound()

  const sql = getDb()

  // Resume existing open order rather than creating a duplicate
  const existing = await sql`
    SELECT id FROM orders
    WHERE table_id = ${tableId}
      AND pos_status NOT IN ('PAID', 'CANCELLED')
    LIMIT 1
  `
  if (existing[0]) redirect(`/pos/order/${existing[0].id}`)

  const [tableRaw, categoriesRaw, menuItems, addonsRaw] = await Promise.all([
    sql`SELECT t.*, s.id AS section_id, s.name AS section_name, s.sort_order AS section_sort_order FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${tableId}`,
    sql`SELECT * FROM menu_categories WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY sort_order ASC`,
    sql`SELECT * FROM menu_items WHERE cafe_id = ${DEMO_CAFE_ID} ORDER BY sort_order ASC`,
    sql`SELECT * FROM addons WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY sort_order ASC, created_at ASC`,
  ])

  if (!tableRaw[0]) notFound()

  type TR = { section_name?: string; section_id?: string; section_sort_order?: number }
  const tr = tableRaw[0] as unknown as TR
  const table: Table = {
    ...(tableRaw[0] as unknown as object),
    section: tr.section_name ? { id: tr.section_id, name: tr.section_name, sort_order: tr.section_sort_order } : null,
  } as unknown as Table

  const cats = categoriesRaw as unknown as { id: string }[]
  const miArr = menuItems as unknown as { category_id: string; is_available: boolean }[]
  const categories: MenuCategory[] = cats.map((c) => ({
    ...c,
    items: miArr.filter((i) => i.category_id === c.id && i.is_available),
  })) as MenuCategory[]

  return (
    <PosOrderClient
      initialOrder={null}
      tableId={tableId}
      initialTable={table}
      categories={categories}
      addons={addonsRaw as unknown as Addon[]}
    />
  )
}
