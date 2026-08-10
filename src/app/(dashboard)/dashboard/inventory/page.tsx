import { getDb } from '@/lib/db'
import type { Ingredient } from '@/lib/types'
import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inventory' }

export default async function InventoryPage() {
  const sql = getDb()
  const ingredients = await sql`SELECT * FROM ingredients ORDER BY name ASC`
  return <InventoryClient ingredients={ingredients as unknown as Ingredient[]} />
}
