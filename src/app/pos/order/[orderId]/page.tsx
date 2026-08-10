import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory, Order } from '@/lib/types'
import PosOrderClient from './PosOrderClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Order' }

export default async function PosOrderPage({ params }: { params: { orderId: string } }) {
  const sql = getDb()

  const [orderRaw, categoriesRaw] = await Promise.all([
    sql`SELECT * FROM orders WHERE id = ${params.orderId}`,
    sql`SELECT * FROM menu_categories WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY sort_order ASC`,
  ])

  if (!orderRaw[0]) notFound()

  const [items, tableRow, menuItems] = await Promise.all([
    sql`SELECT * FROM order_items WHERE order_id = ${params.orderId} ORDER BY created_at`,
    orderRaw[0].table_id
      ? sql`SELECT t.*, s.id AS section_id, s.name AS section_name, s.sort_order AS section_sort_order FROM tables t LEFT JOIN sections s ON s.id = t.section_id WHERE t.id = ${orderRaw[0].table_id}`
      : Promise.resolve([]),
    sql`SELECT * FROM menu_items WHERE cafe_id = ${DEMO_CAFE_ID} ORDER BY sort_order ASC`,
  ])

  type TR = { section_name?: string; section_id?: string; section_sort_order?: number }
  const tr = tableRow[0] as unknown as TR | null ?? null
  const table = tr
    ? { ...tr, section: tr.section_name ? { id: tr.section_id, name: tr.section_name, sort_order: tr.section_sort_order } : null }
    : null
  const order: Order = { ...(orderRaw[0] as unknown as object), items: items as unknown as Order['items'], table } as unknown as Order

  const cats = categoriesRaw as unknown as { id: string }[]
  const miArr = menuItems as unknown as { category_id: string; is_available: boolean }[]
  const categories: MenuCategory[] = cats.map((c) => ({
    ...c,
    items: miArr.filter((i) => i.category_id === c.id && i.is_available),
  })) as MenuCategory[]

  return <PosOrderClient initialOrder={order} categories={categories} />
}
