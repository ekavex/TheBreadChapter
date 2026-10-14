import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import { DEMO_CAFE_ID } from '@/lib/constants'
import { getPrintTemplate } from '@/lib/printTemplates'
import PrintLayoutClient from './PrintLayoutClient'

export const metadata = { title: 'Print Layout' }
export const dynamic = 'force-dynamic'

// Bill + KOT layout editor - admins and managers only.
export default async function PrintLayoutPage() {
  const session = await getSession(cookies().get(SESSION_COOKIE_NAME)?.value)
  if (!session || (session.role !== 'admin' && session.role !== 'manager')) {
    redirect('/dashboard')
  }

  const sql = getDb()
  const [bill, kot, [cafe]] = await Promise.all([
    getPrintTemplate(sql, 'bill'),
    getPrintTemplate(sql, 'kot'),
    sql`SELECT NULLIF(btrim(settings->>'fssai_number'), '') AS fssai FROM cafes WHERE id = ${DEMO_CAFE_ID}`,
  ])

  return <PrintLayoutClient initial={{ bill, kot }} fssaiNumber={(cafe?.fssai as string | null) ?? null} />
}
