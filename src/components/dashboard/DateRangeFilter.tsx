'use client'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CalendarDays, X } from 'lucide-react'

// `from`/`to` as YYYY-MM-DD. A single-date selection is from === to.
export interface DateRangeValue {
  from: string
  to: string
}

interface Props {
  value: DateRangeValue | null
  onChange: (value: DateRangeValue | null) => void
  disabled?: boolean
}

type Mode = 'single' | 'range'

// Calendar filter for analytics/reports: "Single date" applies as soon as a day
// is picked; "Date range" picks a start and end, then Apply. Uses the native
// date input so the calendar popup also works inside the Android POS WebView.
export default function DateRangeFilter({ value, onChange, disabled }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [mode, setMode] = useState<Mode>(value && value.from !== value.to ? 'range' : 'single')
  const [start, setStart] = useState(value?.from ?? '')
  const [end, setEnd] = useState(value?.to ?? '')

  // Keep the inputs in sync when the selection changes from outside
  // (e.g. a preset range button clears it).
  useEffect(() => {
    setStart(value?.from ?? '')
    setEnd(value?.to ?? '')
  }, [value?.from, value?.to])

  const rangeError = mode === 'range' && start && end && end < start ? 'End date must be on or after the start date' : null
  const rangeUnchanged = value?.from === start && value?.to === end
  const canApply = mode === 'range' && !!start && !!end && !rangeError && !rangeUnchanged && !disabled

  function switchMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    if (next === 'single') setEnd(start)
  }

  function pickSingle(day: string) {
    setStart(day)
    setEnd(day)
    if (day) onChange({ from: day, to: day })
  }

  function clear() {
    setStart('')
    setEnd('')
    onChange(null)
  }

  const inputClass =
    'rounded-lg border border-ink/10 bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50'

  return (
    <div className="bg-surface-raised rounded-2xl border border-ink/5 p-3 sm:p-4 no-print">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={16} className="text-ink-muted shrink-0" />
        <div className="flex gap-1">
          {(['single', 'range'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                mode === m ? 'bg-ink text-surface' : 'bg-surface-overlay text-ink-muted hover:text-ink'
              }`}
            >
              {m === 'single' ? 'Single date' : 'Date range'}
            </button>
          ))}
        </div>

        {mode === 'single' ? (
          <input
            type="date"
            aria-label="Date"
            value={start}
            max={today}
            disabled={disabled}
            onChange={(e) => pickSingle(e.target.value)}
            className={inputClass}
          />
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (canApply) onChange({ from: start, to: end })
            }}
          >
            <input
              type="date"
              aria-label="Start date"
              value={start}
              max={end || today}
              disabled={disabled}
              onChange={(e) => setStart(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-ink-faint">to</span>
            <input
              type="date"
              aria-label="End date"
              value={end}
              min={start || undefined}
              max={today}
              disabled={disabled}
              onChange={(e) => setEnd(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={!canApply}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-ink text-surface disabled:opacity-40"
            >
              Apply
            </button>
          </form>
        )}

        {value && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-overlay"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>
      {rangeError && <p className="text-xs text-status-overdue mt-2">{rangeError}</p>}
    </div>
  )
}
