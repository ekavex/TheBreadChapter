'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  BarChart3,
  MonitorPlay,
  ChevronRight,
  Package,
  LogOut,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',              label: 'Overview',     icon: LayoutDashboard },
  { href: '/dashboard/orders',       label: 'Orders',       icon: ClipboardList },
  { href: '/dashboard/inventory',    label: 'Inventory',    icon: Package },
  { href: '/dashboard/menu-manager', label: 'Menu',         icon: UtensilsCrossed },
  { href: '/dashboard/analytics',    label: 'Analytics',    icon: BarChart3 },
  { href: '/kitchen',                label: 'Kitchen view', icon: MonitorPlay },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-surface-raised border-r border-ink/5 shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-ink/5">
          <span className="font-display text-lg font-bold text-ink">Sunrise Cafe</span>
          <p className="text-xs text-ink-faint mt-0.5">Owner dashboard</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
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
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-ink/5 space-y-2">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
          >
            <LogOut size={14} /> Sign out
          </button>
          <p className="text-xs text-ink-faint">Phase 1 · cafe-system</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface-raised border-b border-ink/5">
          <span className="font-display font-bold text-ink">Sunrise Cafe</span>
          <nav className="flex gap-1 ml-auto overflow-x-auto">
            {NAV.slice(0, 4).map(({ href, label, icon: Icon }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </Link>
              )
            })}
          </nav>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
