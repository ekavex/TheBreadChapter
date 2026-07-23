import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Ingredient } from '@/lib/types'
import InventoryClient from './InventoryClient'

export const metadata = { title: 'Inventory' }

export default async function InventoryPage() {
  const supabase = createServerSupabaseClient()

  const { data: ingredients } = await supabase
    .from('ingredients')
    .select('*')
    .order('name', { ascending: true })

  return <InventoryClient ingredients={(ingredients ?? []) as Ingredient[]} />
}
