import { createAdminClient } from '@/lib/supabase/server'
import { getReportData, type ReportData, type ReportRange } from '@/lib/reports'
import ReportsClient from './ReportsClient'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const supabase = createAdminClient()
  const initial = await getReportData(supabase, 'monthly')
  const ranges: ReportRange[] = ['daily', 'weekly', 'monthly']

  return <ReportsClient initial={initial} ranges={ranges} />
}
