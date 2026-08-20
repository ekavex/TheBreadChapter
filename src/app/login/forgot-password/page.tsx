'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [securityKey, setSecurityKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, securityKey, newPassword }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Reset failed')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 2500)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-3">
          <div className="text-4xl">✓</div>
          <h2 className="font-display text-xl font-bold text-ink">Password updated</h2>
          <p className="text-ink-muted text-sm">Redirecting you to login…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">The Bread Chapter</h1>
        <p className="text-ink-muted mt-1">Admin password reset</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-muted mb-1">Admin User ID</label>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. admin"
            className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-muted mb-1">Security Key</label>
          <input
            type="password"
            value={securityKey}
            onChange={(e) => setSecurityKey(e.target.value)}
            placeholder="Server ADMIN_RESET_KEY value"
            className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
            autoComplete="off"
            required
          />
          <p className="text-xs text-ink-muted mt-1">Set in the server <code>.env</code> as <code>ADMIN_RESET_KEY</code></p>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-muted mb-1">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
            autoComplete="new-password"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-muted mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
            autoComplete="new-password"
            required
          />
        </div>

        {error && <p className="text-sm text-status-overdue">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
        >
          {loading ? 'Resetting…' : 'Reset Password'}
        </button>

        <p className="text-center text-sm text-ink-muted">
          <Link href="/login" className="underline underline-offset-2">Back to login</Link>
        </p>
      </form>
    </div>
  )
}
