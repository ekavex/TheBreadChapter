'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Edit2, X, Check, ShieldCheck, User, Users, Printer, CreditCard, Percent } from 'lucide-react'
import type { UserRole } from '@/lib/types'
import { ConfirmModal } from '@/components/dashboard/ConfirmModal'
import PasswordInput from '@/components/PasswordInput'
import toast from 'react-hot-toast'

interface TerminalRow {
  id: string
  client_id: string
  label: string
  section_id: number | null
  created_at: string
}

interface UserRow {
  id: string
  user_id: string
  role: UserRole
  display_name: string
  updated_at: string
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:   'bg-red-50 text-red-700 border-red-200',
  manager: 'bg-brand-50 text-brand-700 border-brand-200',
  staff:   'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  admin:   <ShieldCheck size={12} />,
  manager: <User size={12} />,
  staff:   <Users size={12} />,
}

function readRoleCookie(): UserRole {
  if (typeof document === 'undefined') return 'manager'
  const match = document.cookie.match(/(?:^|;\s*)sc_role=([^;]+)/)
  const val = match?.[1]
  if (val === 'admin' || val === 'manager' || val === 'staff') return val
  return 'manager'
}

export default function AdminClient() {
  const [viewerRole, setViewerRole] = useState<UserRole>('manager')
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => { setViewerRole(readRoleCookie()) }, [])

  // ── My account (self-service name/password change) ────────────────
  const [myUserId, setMyUserId] = useState('')
  const [myDisplayName, setMyDisplayName] = useState('')
  const [myPassword, setMyPassword] = useState('')
  const [myLoading, setMyLoading] = useState(true)
  const [mySaving, setMySaving] = useState(false)

  useEffect(() => {
    fetch('/api/account')
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setMyUserId(j.data.user_id)
          setMyDisplayName(j.data.display_name ?? '')
        }
      })
      .finally(() => setMyLoading(false))
  }, [])

  async function saveMyAccount(e: React.FormEvent) {
    e.preventDefault()
    setMySaving(true)
    try {
      const body: Record<string, unknown> = { displayName: myDisplayName }
      if (myPassword) body.password = myPassword
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to update account'); return }
      toast.success('Account updated')
      setMyPassword('')
    } finally {
      setMySaving(false)
    }
  }

  // ── Delete modals ────────────────────────────────────────────────
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null)
  const [deleteTerminal, setDeleteTerminal] = useState<TerminalRow | null>(null)

  // ── Tax settings ─────────────────────────────────────────────────
  const [taxPercent, setTaxPercent] = useState('')
  const [serviceChargePercent, setServiceChargePercent] = useState('')
  const [taxLoading, setTaxLoading] = useState(true)
  const [taxSaving, setTaxSaving] = useState(false)

  // ── Terminal (A910S) management ──────────────────────────────────
  const [terminals, setTerminals] = useState<TerminalRow[]>([])
  const [termLoading, setTermLoading] = useState(true)
  const [showAddTerminal, setShowAddTerminal] = useState(false)
  const [newClientId, setNewClientId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [termSaving, setTermSaving] = useState(false)

  const fetchTerminals = useCallback(async () => {
    setTermLoading(true)
    try {
      const res = await fetch('/api/admin/terminals')
      const json = await res.json()
      if (res.ok) setTerminals(json.data ?? [])
    } finally {
      setTermLoading(false)
    }
  }, [])

  useEffect(() => { fetchTerminals() }, [fetchTerminals])

  async function handleAddTerminal(e: React.FormEvent) {
    e.preventDefault()
    setTermSaving(true)
    try {
      const res = await fetch('/api/admin/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: newClientId, label: newLabel }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to add terminal'); return }
      toast.success('Terminal added')
      setShowAddTerminal(false)
      setNewClientId(''); setNewLabel('')
      await fetchTerminals()
    } finally {
      setTermSaving(false)
    }
  }

  async function confirmDeleteTerminal() {
    if (!deleteTerminal) return
    const t = deleteTerminal
    setDeleteTerminal(null)
    const res = await fetch(`/api/admin/terminals/${t.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? 'Failed to delete'); return }
    toast.success('Terminal removed')
    await fetchTerminals()
  }

  // Add form state
  const [newUserId, setNewUserId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('staff')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [saving, setSaving] = useState(false)

  // Edit form state
  const [editRole, setEditRole] = useState<UserRole>('staff')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editPassword, setEditPassword] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      if (res.ok) setUsers(json.data ?? [])
      else toast.error(json.error ?? 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // Tax settings load
  useEffect(() => {
    fetch('/api/admin/settings/cafe')
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setTaxPercent(String(j.data.tax_percent ?? 0))
          setServiceChargePercent(String(j.data.service_charge_percent ?? 0))
        }
      })
      .finally(() => setTaxLoading(false))
  }, [])

  async function saveTaxSettings(e: React.FormEvent) {
    e.preventDefault()
    setTaxSaving(true)
    try {
      const res = await fetch('/api/admin/settings/cafe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tax_percent: parseFloat(taxPercent) || 0,
          service_charge_percent: parseFloat(serviceChargePercent) || 0,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to save'); return }
      toast.success('Tax settings saved')
    } finally {
      setTaxSaving(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: newUserId, password: newPassword, role: newRole, displayName: newDisplayName }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to create user'); return }
      toast.success(`User "${newUserId}" created`)
      setShowAdd(false)
      setNewUserId(''); setNewPassword(''); setNewDisplayName(''); setNewRole('staff')
      await fetchUsers()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(u: UserRow) {
    setEditId(u.id)
    setEditRole(u.role)
    setEditDisplayName(u.display_name)
    setEditPassword('')
  }

  async function handleEdit(id: string) {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { role: editRole, displayName: editDisplayName }
      if (editPassword) body.password = editPassword
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to update user'); return }
      toast.success('User updated')
      setEditId(null)
      await fetchUsers()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteUser() {
    if (!deleteUser) return
    const u = deleteUser
    setDeleteUser(null)
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? 'Failed to delete user'); return }
    toast.success(`User "${u.user_id}" deleted`)
    await fetchUsers()
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            {viewerRole === 'admin' ? 'User Management' : 'Staff Management'}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {viewerRole === 'admin' ? 'Manage staff logins and access levels' : 'Create and manage staff accounts'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-surface text-sm font-medium"
        >
          <Plus size={14} /> Add user
        </button>
      </div>

      {/* My account */}
      <div className="mb-6 p-4 bg-surface-raised rounded-2xl border border-ink/8">
        <p className="font-semibold text-sm text-ink mb-3">My account</p>
        {myLoading ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : (
          <form onSubmit={saveMyAccount} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">User ID</label>
                <input
                  disabled
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink-faint bg-surface-overlay"
                  value={myUserId}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Display name</label>
                <input
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={myDisplayName} onChange={e => setMyDisplayName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">New password</label>
                <PasswordInput
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={myPassword} onChange={e => setMyPassword(e.target.value)}
                  placeholder="Leave blank to keep"
                  minLength={6}
                />
              </div>
            </div>
            <button
              type="submit" disabled={mySaving}
              className="px-4 py-2 rounded-xl bg-ink text-surface text-sm font-medium disabled:opacity-50"
            >
              {mySaving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>

      {/* Add user form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="mb-6 p-4 bg-surface-raised rounded-2xl border border-ink/8 space-y-3"
        >
          <p className="font-semibold text-sm text-ink mb-1">New user</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">User ID</label>
              <input
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newUserId} onChange={e => setNewUserId(e.target.value)}
                placeholder="e.g. john_staff" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Display name</label>
              <input
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)}
                placeholder="e.g. John"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Password</label>
              <PasswordInput
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={6}
              />
            </div>
            {viewerRole === 'admin' && (
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Role</label>
              <select
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newRole} onChange={e => setNewRole(e.target.value as UserRole)}
              >
                <option value="staff">Staff - POS + Menu</option>
                <option value="manager">Manager - Full dashboard</option>
                <option value="admin">Admin - Full access + user management</option>
              </select>
            </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 rounded-xl bg-ink text-surface text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button" onClick={() => setShowAdd(false)}
              className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:bg-surface-overlay"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="bg-surface-raised rounded-2xl border border-ink/8 overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-ink-faint">Loading…</div>
        ) : users.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-faint">No users found</div>
        ) : (
          <div className="divide-y divide-ink/5">
            {users.map(u => (
              <div key={u.id} className="px-4 py-3">
                {editId === u.id ? (
                  /* ── Edit row ── */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-ink">{u.user_id}</span>
                      <span className="text-xs text-ink-faint">editing</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">Display name</label>
                        <input
                          className="w-full rounded-xl border border-ink/10 px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                          value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)}
                        />
                      </div>
                      {viewerRole === 'admin' && (
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">Role</label>
                        <select
                          className="w-full rounded-xl border border-ink/10 px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                          value={editRole} onChange={e => setEditRole(e.target.value as UserRole)}
                        >
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">New password (optional)</label>
                        <PasswordInput
                          className="w-full rounded-xl border border-ink/10 px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                          value={editPassword} onChange={e => setEditPassword(e.target.value)}
                          placeholder="Leave blank to keep"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(u.id)} disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-surface text-xs font-medium disabled:opacity-50"
                      >
                        <Check size={12} /> Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-ink-muted hover:bg-surface-overlay"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Normal row ── */
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-ink">{u.user_id}</span>
                        {u.display_name && (
                          <span className="text-xs text-ink-faint">({u.display_name})</span>
                        )}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ROLE_COLORS[u.role]}`}>
                          {ROLE_ICONS[u.role]} {u.role}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(u)}
                        className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay hover:text-ink transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteUser(u)}
                        className="p-1.5 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="mt-6 p-4 bg-surface-raised rounded-2xl border border-ink/8">
        <p className="text-xs font-semibold text-ink-muted mb-3">Role access summary</p>
        <div className="space-y-2 text-xs text-ink-muted">
          <div className="flex gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${ROLE_COLORS.admin}`}>
              {ROLE_ICONS.admin} admin
            </span>
            <span>Full access - all dashboard sections, analytics, reports, user management</span>
          </div>
          <div className="flex gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${ROLE_COLORS.manager}`}>
              {ROLE_ICONS.manager} manager
            </span>
            <span>Full dashboard - overview, orders, inventory, menu, analytics, reports, POS</span>
          </div>
          <div className="flex gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${ROLE_COLORS.staff}`}>
              {ROLE_ICONS.staff} staff
            </span>
            <span>POS + Menu manager only - menu changes are logged as notifications to managers</span>
          </div>
        </div>
      </div>

      {/* ── Admin-only sections ─────────────────────────────────────────────── */}
      {viewerRole === 'admin' && <>

      {/* ── Payment Terminals (Pine Labs A910S) ───────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-ink-muted" />
            <h2 className="font-display text-xl font-bold text-ink">Payment Terminals</h2>
          </div>
          <button
            onClick={() => setShowAddTerminal(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ink text-surface text-xs font-medium"
          >
            <Plus size={12} /> Add terminal
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Pine Labs A910S card machines. Add the <strong>Client ID</strong> from each device
          (printed on the device or provided by Pine Labs during onboarding).
        </p>

        {showAddTerminal && (
          <form onSubmit={handleAddTerminal} className="mb-4 p-4 bg-surface-raised rounded-2xl border border-ink/8 space-y-3">
            <p className="font-semibold text-sm text-ink">Add terminal</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Client ID <span className="text-status-overdue">*</span></label>
                <input
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={newClientId} onChange={e => setNewClientId(e.target.value)}
                  placeholder="e.g. 12345" required
                />
                <p className="text-[10px] text-ink-faint mt-0.5">Number from Pine Labs - found on the A910S device or in their onboarding email.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Label <span className="text-status-overdue">*</span></label>
                <input
                  className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="e.g. Counter Terminal" required
                />
                <p className="text-[10px] text-ink-faint mt-0.5">Friendly name to identify this machine.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={termSaving}
                className="px-4 py-2 rounded-xl bg-ink text-surface text-sm font-medium disabled:opacity-50">
                {termSaving ? 'Adding…' : 'Add'}
              </button>
              <button type="button" onClick={() => setShowAddTerminal(false)}
                className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:bg-surface-overlay">
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="bg-surface-raised rounded-2xl border border-ink/8 overflow-hidden">
          {termLoading ? (
            <div className="px-6 py-8 text-center text-sm text-ink-faint">Loading…</div>
          ) : terminals.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-ink-faint">
              No terminals added yet. Add the Client ID from your Pine Labs A910S device.
            </div>
          ) : (
            <div className="divide-y divide-ink/5">
              {terminals.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <CreditCard size={16} className="text-ink-faint shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-ink">{t.label}</span>
                    <span className="ml-2 font-mono text-xs text-ink-muted">Client ID: {t.client_id}</span>
                  </div>
                  <button
                    onClick={() => setDeleteTerminal(t)}
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Remove terminal"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Tax & Service Charge Settings ──────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Percent size={18} className="text-ink-muted" />
          <h2 className="font-display text-xl font-bold text-ink">Tax &amp; Service Charge</h2>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Applied automatically when generating a bill. Set to 0 to disable.
        </p>
        {taxLoading ? (
          <div className="p-6 text-center text-sm text-ink-faint">Loading…</div>
        ) : (
          <form onSubmit={saveTaxSettings} className="p-4 bg-surface-raised rounded-2xl border border-ink/8 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">GST / Tax %</label>
                <div className="relative">
                  <input
                    type="number" min="0" max="100" step="0.01"
                    className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400 pr-8"
                    value={taxPercent}
                    onChange={e => setTaxPercent(e.target.value)}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">%</span>
                </div>
                <p className="text-[10px] text-ink-faint mt-0.5">e.g. 5 for 5% GST</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Service Charge %</label>
                <div className="relative">
                  <input
                    type="number" min="0" max="100" step="0.01"
                    className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400 pr-8"
                    value={serviceChargePercent}
                    onChange={e => setServiceChargePercent(e.target.value)}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">%</span>
                </div>
                <p className="text-[10px] text-ink-faint mt-0.5">e.g. 10 for 10% service charge</p>
              </div>
            </div>
            <button
              type="submit" disabled={taxSaving}
              className="px-5 py-2 rounded-xl bg-ink text-surface text-sm font-medium disabled:opacity-50"
            >
              {taxSaving ? 'Saving…' : 'Save tax settings'}
            </button>
          </form>
        )}
      </div>

      {/* ── Printer Settings ──────────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Printer size={18} className="text-ink-muted" />
          <h2 className="font-display text-xl font-bold text-ink">Thermal Printers</h2>
        </div>
        <div className="p-4 bg-surface-raised rounded-2xl border border-ink/8 text-sm text-ink-muted space-y-2">
          <p>Printing is handled by the <strong className="text-ink">Android APK print bridge</strong> on the tablet - no server-side configuration needed.</p>
          <p>To configure printers: open the APK → long-press anywhere → tap the gear icon → enter the Bluetooth MAC address for each printer.</p>
          <p className="text-xs text-ink-faint">Kitchen printer and Barista printer are configured separately in the APK settings.</p>
        </div>
      </div>

      </>}

      {deleteUser && (
        <ConfirmModal
          title="Delete user?"
          message={`Delete user "${deleteUser.user_id}"? This cannot be undone.`}
          onConfirm={confirmDeleteUser}
          onCancel={() => setDeleteUser(null)}
        />
      )}
      {deleteTerminal && (
        <ConfirmModal
          title="Remove terminal?"
          message={`Remove terminal "${deleteTerminal.label}" (Client ID: ${deleteTerminal.client_id})?`}
          confirmLabel="Remove"
          onConfirm={confirmDeleteTerminal}
          onCancel={() => setDeleteTerminal(null)}
        />
      )}
    </div>
  )
}
