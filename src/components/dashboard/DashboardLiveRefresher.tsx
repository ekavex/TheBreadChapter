'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// "Real-time dashboard" per docs/DEVELOPER_HANDOVER_MASTER.md §11 - polling
// is an explicitly acceptable fallback to a websocket push. Re-runs the
// server component on an interval so tiles/table statuses stay current
// without a manual refresh.
export default function DashboardLiveRefresher({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])

  return null
}
