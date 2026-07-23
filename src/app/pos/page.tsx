import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Section, Table } from '@/lib/types'
import PosTablesClient from './PosTablesClient'

export const metadata = { title: 'Waiter POS' }

export default async function PosTablesPage() {
  const supabase = createServerSupabaseClient()

  const [{ data: sections }, { data: tables }] = await Promise.all([
    supabase.from('sections').select('*').order('sort_order', { ascending: true }),
    supabase.from('tables').select('*').eq('cafe_id', DEMO_CAFE_ID).eq('is_active', true).order('number', { ascending: true }),
  ])

  const bySection = ((sections ?? []) as Section[]).map((section) => ({
    section,
    tables: ((tables ?? []) as Table[]).filter((t) => t.section_id === section.id),
  }))

  return <PosTablesClient bySection={bySection} />
}
