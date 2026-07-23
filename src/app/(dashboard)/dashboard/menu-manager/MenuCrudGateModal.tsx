'use client'
import { useState } from 'react'
import { X, ShieldCheck } from 'lucide-react'

interface Props {
  actionLabel: string // e.g. "Add Menu Item", "Delete Category"
  onVerified: (token: string) => void
  onCancel: () => void
}

// Module 9: a second, separate credential set — re-verified per action, not
// a session/role. This popup is the "Click Add / Edit / Delete Menu →
// Popup: enter Menu User ID & Password → Credentials verified" step.
export default function MenuCrudGateModal({ actionLabel, onVerified, onCancel }: Props) {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setChecking(true)
    try {
      const res = await fetch('/api/auth/verify-menu-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      })
      const { data, error } = await res.json()
      if (error) {
        setError(error)
        return
      }
      onVerified(data.token)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface-raised rounded-2xl w-full max-w-sm p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand-500" />
            <h2 className="font-display text-lg font-semibold text-ink">Menu Credentials</h2>
          </div>
          <button onClick={onCancel} className="p-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-4">Confirm to: {actionLabel}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">User ID</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              required
            />
          </div>
          {error && <p className="text-sm text-status-overdue">{error}</p>}
          <button
            type="submit"
            disabled={checking}
            className="w-full rounded-xl bg-ink text-surface py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {checking ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
