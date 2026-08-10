'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Edit2, X, Check, ShieldCheck, User, Users, Printer, Wifi, Usb, HardDrive } from 'lucide-react'
import type { UserRole } from '@/lib/types'
import toast from 'react-hot-toast'

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

interface PrinterStationCfg {
  btDevice?: string
  usbDevice?: string
  ip?: string
}
interface PrinterCfg {
  kitchen: PrinterStationCfg
  beverage_counter: PrinterStationCfg
}

export default function AdminClient() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // ── Printer settings ────────────────────────────────────────────
  const [printerCfg, setPrinterCfg] = useState<PrinterCfg>({
    kitchen:          { btDevice: '', usbDevice: '', ip: '' },
    beverage_counter: { btDevice: '', usbDevice: '', ip: '' },
  })
  const [printerLoading, setPrinterLoading] = useState(true)
  const [printerSaving, setPrinterSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

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

  // Printer config load
  useEffect(() => {
    fetch('/api/admin/settings/printers')
      .then(r => r.json())
      .then(j => { if (j.data) setPrinterCfg(j.data) })
      .finally(() => setPrinterLoading(false))
  }, [])

  async function savePrinters(e: React.FormEvent) {
    e.preventDefault()
    setPrinterSaving(true)
    try {
      const res = await fetch('/api/admin/settings/printers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(printerCfg),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to save'); return }
      toast.success('Printer settings saved')
    } finally {
      setPrinterSaving(false)
    }
  }

  async function testPrint(station: string) {
    setTesting(station)
    try {
      const res = await fetch(`/api/admin/settings/printers?action=test&station=${station}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) toast.error(json.error ?? 'Test failed')
      else toast.success(`Test sent via ${json.data?.method}`)
    } finally {
      setTesting(null)
    }
  }

  function updateStation(station: keyof PrinterCfg, field: keyof PrinterStationCfg, value: string) {
    setPrinterCfg(prev => ({ ...prev, [station]: { ...prev[station], [field]: value } }))
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

  async function handleDelete(u: UserRow) {
    if (!confirm(`Delete user "${u.user_id}"? This cannot be undone.`)) return
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
          <h1 className="font-display text-2xl font-bold text-ink">User Management</h1>
          <p className="text-sm text-ink-muted mt-0.5">Manage staff logins and access levels</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-surface text-sm font-medium"
        >
          <Plus size={14} /> Add user
        </button>
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
              <input
                type="password"
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={6}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Role</label>
              <select
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400"
                value={newRole} onChange={e => setNewRole(e.target.value as UserRole)}
              >
                <option value="staff">Staff — POS + Menu</option>
                <option value="manager">Manager — Full dashboard</option>
                <option value="admin">Admin — Full access + user management</option>
              </select>
            </div>
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
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">New password (optional)</label>
                        <input
                          type="password"
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
                        onClick={() => handleDelete(u)}
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
            <span>Full access — all dashboard sections, analytics, reports, user management</span>
          </div>
          <div className="flex gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${ROLE_COLORS.manager}`}>
              {ROLE_ICONS.manager} manager
            </span>
            <span>Full dashboard — overview, orders, inventory, menu, analytics, reports, POS</span>
          </div>
          <div className="flex gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${ROLE_COLORS.staff}`}>
              {ROLE_ICONS.staff} staff
            </span>
            <span>POS + Menu manager only — menu changes are logged as notifications to managers</span>
          </div>
        </div>
      </div>

      {/* ── Printer Settings ───────────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Printer size={18} className="text-ink-muted" />
          <h2 className="font-display text-xl font-bold text-ink">Thermal Printer Settings</h2>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Configure device paths for kitchen and beverage printers. On each print the app tries
          Bluetooth first, falls back to USB automatically. Leave a field blank to skip that method.
        </p>

        {printerLoading ? (
          <div className="p-6 text-center text-sm text-ink-faint">Loading…</div>
        ) : (
          <form onSubmit={savePrinters} className="space-y-4">
            {(
              [
                { key: 'kitchen' as const,          label: 'Kitchen Printer',   color: 'bg-orange-50 border-orange-200 text-orange-700' },
                { key: 'beverage_counter' as const, label: 'Beverage Printer',  color: 'bg-blue-50 border-blue-200 text-blue-700' },
              ] as const
            ).map(({ key, label, color }) => (
              <div key={key} className="p-4 bg-surface-raised rounded-2xl border border-ink/8">
                <div className="flex items-center justify-between mb-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
                    <Printer size={11} /> {label}
                  </span>
                  <button
                    type="button"
                    disabled={testing === key}
                    onClick={() => testPrint(key)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-ink/12 text-ink-muted hover:bg-surface-overlay disabled:opacity-50 transition-colors"
                  >
                    {testing === key ? 'Printing…' : 'Test print'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted mb-1">
                      <Wifi size={11} /> Bluetooth device
                    </label>
                    <input
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                      placeholder="/dev/rfcomm0"
                      value={printerCfg[key].btDevice ?? ''}
                      onChange={e => updateStation(key, 'btDevice', e.target.value)}
                    />
                    <p className="text-[10px] text-ink-faint mt-0.5">Tried first. Requires rfcomm bind.</p>
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted mb-1">
                      <Usb size={11} /> USB device
                    </label>
                    <input
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                      placeholder="/dev/usb/lp0"
                      value={printerCfg[key].usbDevice ?? ''}
                      onChange={e => updateStation(key, 'usbDevice', e.target.value)}
                    />
                    <p className="text-[10px] text-ink-faint mt-0.5">Fallback when BT is unavailable.</p>
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted mb-1">
                      <HardDrive size={11} /> Network IP
                    </label>
                    <input
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                      placeholder="192.168.1.100"
                      value={printerCfg[key].ip ?? ''}
                      onChange={e => updateStation(key, 'ip', e.target.value)}
                    />
                    <p className="text-[10px] text-ink-faint mt-0.5">TCP port 9100. Used if BT+USB absent.</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={printerSaving}
                className="px-5 py-2 rounded-xl bg-ink text-surface text-sm font-medium disabled:opacity-50"
              >
                {printerSaving ? 'Saving…' : 'Save printer settings'}
              </button>
              <p className="text-xs text-ink-faint">Changes apply immediately — no restart needed.</p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
