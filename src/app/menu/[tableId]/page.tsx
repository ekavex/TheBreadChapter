import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import type { MenuPageData, Cafe, MenuCategory } from '@/lib/types'
import MenuShell from '@/components/menu/MenuShell'

interface Props {
  params: { tableId: string }
  searchParams: { cafe?: string }
}

export async function generateMetadata({ searchParams }: Props) {
  const sql = getDb()
  const cafeSlug = searchParams.cafe ?? 'the-bread-chapter'
  const [cafe] = await sql`SELECT name FROM cafes WHERE slug = ${cafeSlug} LIMIT 1`
  return { title: cafe?.name ?? 'Menu' }
}

export default async function MenuPage({ params, searchParams }: Props) {
  const sql = getDb()
  const cafeSlug = searchParams.cafe ?? 'the-bread-chapter'
  const tableNumber = parseInt(params.tableId, 10)

  const [cafeRow] = await sql`SELECT * FROM cafes WHERE slug = ${cafeSlug} AND is_active = true LIMIT 1`
  if (!cafeRow) notFound()

  const [tableRow, categoriesRaw, menuItems] = await Promise.all([
    sql`SELECT * FROM tables WHERE cafe_id = ${cafeRow.id} AND number = ${tableNumber} AND is_active = true LIMIT 1`,
    sql`SELECT * FROM menu_categories WHERE cafe_id = ${cafeRow.id} AND is_active = true ORDER BY sort_order ASC`,
    sql`SELECT * FROM menu_items WHERE cafe_id = ${cafeRow.id} AND is_available = true ORDER BY sort_order ASC`,
  ])

  if (!tableRow[0]) notFound()

  const cats = categoriesRaw as unknown as { id: string }[]
  const miArr = menuItems as unknown as { category_id: string }[]
  const categories: MenuCategory[] = cats.map((c) => ({
    ...c,
    items: miArr.filter((i) => i.category_id === c.id),
  })) as MenuCategory[]

  const pageData: MenuPageData = {
    cafe: cafeRow as unknown as Cafe,
    table: tableRow[0] as unknown as MenuPageData['table'],
    categories,
  }

  return <MenuShell data={pageData} />
}
