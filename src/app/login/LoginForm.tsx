'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { UserRole } from '@/lib/types'

function defaultRedirect(_role: UserRole): string {
  return '/dashboard'
}

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password, rememberMe }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Login failed')
        return
      }
      const role: UserRole = json.data?.role ?? 'manager'
      const next = searchParams.get('next') ?? defaultRedirect(role)
      router.push(next)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label className="block text-sm font-medium text-ink-muted mb-1">User ID</label>
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-muted mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
          autoComplete="current-password"
          required
        />
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="w-4 h-4 rounded border-ink/20 accent-ink cursor-pointer"
        />
        <span className="text-sm text-ink-muted">Keep me signed in for 30 days</span>
      </label>
      {error && <p className="text-sm text-status-overdue">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-ink text-surface py-2.5 font-medium disabled:opacity-50"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
