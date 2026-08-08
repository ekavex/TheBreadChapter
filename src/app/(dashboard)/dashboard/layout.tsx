'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, ClipboardList, UtensilsCrossed, BarChart3,
  ChevronRight, Package, LogOut, Utensils, FileBarChart, Menu, X, ShieldCheck,
} from 'lucide-react'
import NotificationBell from '@/components/dashboard/NotificationBell'
import type { UserRole } from '@/lib/types'

const ALL_NAV = [
  { href: '/dashboard',              label: 'Overview',   icon: LayoutDashboard, roles: ['admin', 'manager'] as UserRole[] },
  { href: '/pos',                    label: 'Waiter POS', icon: Utensils,         roles: ['admin', 'manager', 'staff'] as UserRole[] },
  { href: '/dashboard/orders',       label: 'Orders',     icon: ClipboardList,    roles: ['admin', 'manager'] as UserRole[] },
  { href: '/dashboard/inventory',    label: 'Inventory',  icon: Package,          roles: ['admin', 'manager'] as UserRole[] },
  { href: '/dashboard/menu-manager', label: 'Menu',       icon: UtensilsCrossed,  roles: ['admin', 'manager', 'staff'] as UserRole[] },
  { href: '/dashboard/analytics',    label: 'Analytics',  icon: BarChart3,        roles: ['admin', 'manager'] as UserRole[] },
  { href: '/dashboard/reports',      label: 'Reports',    icon: FileBarChart,     roles: ['admin', 'manager'] as UserRole[] },
  { href: '/dashboard/admin',        label: 'Admin',      icon: ShieldCheck,      roles: ['admin'] as UserRole[] },
]

function readRoleCookie(): UserRole {
  if (typeof document === 'undefined') return 'manager'
  const match = document.cookie.match(/(?:^|;\s*)sc_role=([^;]+)/)
  const val = match?.[1]
  if (val === 'admin' || val === 'manager' || val === 'staff') return val
  return 'manager'
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [role, setRole] = useState<UserRole>('manager')

  useEffect(() => {
    setRole(readRoleCookie())
  }, [])

  const nav = ALL_NAV.filter(n => n.roles.includes(role))

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  function NavLinks({ onClick }: { onClick?: () => void }) {
    return (
      <>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group ${
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-muted hover:bg-surface-overlay hover:text-ink'
              }`}
            >
              <Icon size={16} className={active ? 'text-brand-500' : 'text-ink-faint group-hover:text-ink-muted'} />
              {label}
              {active && <ChevronRight size={12} className="ml-auto text-brand-400" />}
            </Link>
          )
        })}
      </>
    )
  }

  const roleLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Staff'

  return (
    <div className="min-h-screen bg-surface flex">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex flex-col w-56 bg-surface-raised border-r border-ink/5 shrink-0">
        <div className="px-5 py-4 border-b border-ink/5 flex items-center justify-between">
          <div>
            <span className="font-display text-lg font-bold text-ink">The Bread Chapter</span>
            <p className="text-xs text-ink-faint mt-0.5 capitalize">{roleLabel} dashboard</p>
          </div>
          <NotificationBell side="left" />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <NavLinks />
        </nav>
        <div className="px-5 py-4 border-t border-ink/5 space-y-2">
          <button onClick={handleSignOut} className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <LogOut size={14} /> Sign out
          </button>
          <p className="text-xs text-ink-faint">Phase 1 · cafe-system</p>
        </div>
      </aside>

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile slide-in drawer ── */}
      <aside className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-surface-raised border-r border-ink/5 flex flex-col transform transition-transform duration-300 ease-in-out ${
        drawerOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/5">
          <div>
            <span className="font-display text-base font-bold text-ink">The Bread Chapter</span>
            <p className="text-xs text-ink-faint mt-0.5 capitalize">{roleLabel} dashboard</p>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-overlay"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavLinks onClick={() => setDrawerOpen(false)} />
        </nav>
        <div className="px-5 py-4 border-t border-ink/5 space-y-2">
          <button onClick={handleSignOut} className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <LogOut size={14} /> Sign out
          </button>
          <p className="text-xs text-ink-faint">Phase 1 · cafe-system</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-3 bg-surface-raised border-b border-ink/5">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-1 rounded-xl text-ink-muted hover:bg-surface-overlay transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="font-display font-bold text-ink text-sm truncate">The Bread Chapter</span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <NotificationBell />
            <span className="text-xs font-medium text-ink-muted bg-surface-overlay border border-ink/8 px-2.5 py-1 rounded-full">
              {nav.find(n => n.href === pathname)?.label ?? 'Dashboard'}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
