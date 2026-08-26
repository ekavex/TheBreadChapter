import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { MenuCategory, Ingredient, Addon } from '@/lib/types'
import MenuManagerClient from './MenuManagerClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Menu Manager' }

export default async function MenuManagerPage() {
  const sql = getDb()

  const [categoriesRaw, itemsRaw, ingredientsRaw, addonsRaw] = await Promise.all([
    sql`SELECT * FROM menu_categories WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY sort_order ASC`,
    sql`SELECT * FROM menu_items WHERE cafe_id = ${DEMO_CAFE_ID} ORDER BY sort_order ASC`,
    sql`SELECT * FROM ingredients ORDER BY name ASC`,
    sql`SELECT * FROM addons WHERE cafe_id = ${DEMO_CAFE_ID} ORDER BY sort_order ASC, created_at ASC`,
  ])

  const cats = categoriesRaw as unknown as { id: string }[]
  const items = itemsRaw as unknown as { category_id: string }[]
  const categories: MenuCategory[] = cats.map((c) => ({
    ...c,
    items: items.filter((i) => i.category_id === c.id),
  })) as MenuCategory[]

  return (
    <MenuManagerClient
      categories={categories}
      ingredients={ingredientsRaw as unknown as Ingredient[]}
      addons={addonsRaw as unknown as Addon[]}
    />
  )
}
