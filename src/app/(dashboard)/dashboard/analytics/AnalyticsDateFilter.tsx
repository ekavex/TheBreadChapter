'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import DateRangeFilter, { type DateRangeValue } from '@/components/dashboard/DateRangeFilter'

// The analytics page is server-rendered from the URL (?from=&to=), so the
// filter just navigates and the page re-renders with that window's data.
export default function AnalyticsDateFilter({ value }: { value: DateRangeValue | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleChange(next: DateRangeValue | null) {
    const href = next
      ? `/dashboard/analytics?from=${next.from}&to=${next.to}`
      : '/dashboard/analytics'
    startTransition(() => router.push(href))
  }

  return (
    <div className="space-y-1">
      <DateRangeFilter value={value} onChange={handleChange} disabled={pending} />
      {pending && <p className="text-xs text-ink-faint px-1">Loading…</p>}
    </div>
  )
}
