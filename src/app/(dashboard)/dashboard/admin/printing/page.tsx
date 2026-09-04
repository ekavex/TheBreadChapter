import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { getPrintOverview, getStuckPrintJobs, getPrintLogFeed, getOrderPrintSummaries } from '@/lib/printing'
import PrintingClient from './PrintingClient'

export const metadata = { title: 'Printing' }
export const dynamic = 'force-dynamic'

export default async function PrintingPage() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value
  const session = await getSession(token)
  if (!session || session.role !== 'admin') {
    redirect('/dashboard')
  }

  const [overview, stuck, feed, flagged] = await Promise.all([
    getPrintOverview(),
    getStuckPrintJobs(),
    getPrintLogFeed(150),
    getOrderPrintSummaries(),
  ])

  return <PrintingClient initial={{ overview, stuck, feed, flagged }} />
}
