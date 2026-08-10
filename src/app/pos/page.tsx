import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Section, Table } from '@/lib/types'
import PosTablesClient from './PosTablesClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Waiter POS' }

export default async function PosTablesPage() {
  const sql = getDb()

  const [sections, tables] = await Promise.all([
    sql`SELECT * FROM sections ORDER BY sort_order ASC`,
    sql`SELECT * FROM tables WHERE cafe_id = ${DEMO_CAFE_ID} AND is_active = true ORDER BY number ASC`,
  ])

  const bySection = (sections as unknown as Section[]).map((section) => ({
    section,
    tables: (tables as unknown as Table[]).filter((t) => t.section_id === section.id),
  }))

  return <PosTablesClient bySection={bySection} />
}
