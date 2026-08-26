import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireDashboardSession, getSessionUser } from '@/lib/auth/requireDashboardSession'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Ingredient } from '@/lib/types'

export const dynamic = 'force-dynamic'

export type NotificationSeverity = 'critical' | 'warning' | 'info'

export interface AppNotification {
  id: string
  severity: NotificationSeverity
  title: string
  body: string
  href?: string
  createdAt: string
}

export async function GET(req: NextRequest) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const user = await getSessionUser(req)
    const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'manager'
    const isAdmin = user?.role === 'admin'

    const sql = getDb()
    const today = new Date().toISOString().split('T')[0]
    const soonCutoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const unsettledCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // Unsettled money is the highest-priority notification there is: an order
    // whose payment we could not resolve must never quietly disappear.
    const [ingredientsResult, stuckOrdersResult, staffNotifResult, unsettledResult] = await Promise.all([
      sql`SELECT * FROM ingredients ORDER BY name`,
      sql`
        SELECT id, order_number, status, created_at FROM orders
        WHERE cafe_id = ${DEMO_CAFE_ID}
          AND status = ANY(${sql.array(['pending', 'confirmed'])}::order_status[])
          AND created_at <= ${stuckCutoff}
      `,
      isAdmin
        ? sql`
            SELECT * FROM staff_notifications
            WHERE cafe_id = ${DEMO_CAFE_ID} AND is_read = false
            ORDER BY created_at DESC
            LIMIT 20
          `
        : Promise.resolve([]),
      sql`
        SELECT id, order_number, pos_status, total_amount, updated_at
        FROM orders
        WHERE cafe_id = ${DEMO_CAFE_ID}
          AND pos_status IN ('REQUIRES_VERIFICATION', 'AWAITING_PAYMENT')
          AND updated_at <= ${unsettledCutoff}
        ORDER BY updated_at ASC
        LIMIT 20
      `,
    ])

    const items = ingredientsResult as unknown as Ingredient[]
    const notifications: AppNotification[] = []
    const now = new Date().toISOString()

    // Visible to every role — whoever is on the floor needs to act on this.
    ;(unsettledResult as unknown as {
      id: string; order_number: string; pos_status: string; total_amount: number; updated_at: string
    }[]).forEach((o) => {
      const mins = Math.round((Date.now() - new Date(o.updated_at).getTime()) / 60000)
      const needsHuman = o.pos_status === 'REQUIRES_VERIFICATION'
      notifications.push({
        id: `unsettled-${o.id}`,
        severity: 'critical',
        title: needsHuman
          ? `Order ${o.order_number} — payment needs verification`
          : `Order ${o.order_number} — payment unresolved for ${mins} min`,
        body: needsHuman
          ? `₹${o.total_amount}: check the terminal and the Pine Labs report before charging again.`
          : `₹${o.total_amount} has been awaiting the terminal for ${mins} min.`,
        href: `/pos/order/${o.id}`,
        createdAt: o.updated_at,
      })
    })

    if (isManagerOrAdmin) {
      // ── Expired ingredients ──────────────────────────────────
      items
        .filter(i => i.expiry_date && i.expiry_date < today)
        .forEach(i => {
          notifications.push({
            id: `expired-${i.id}`,
            severity: 'critical',
            title: `${i.name} has expired`,
            body: `Expired on ${i.expiry_date}. Remove or replace immediately.`,
            href: '/dashboard/inventory',
            createdAt: now,
          })
        })

      // ── Expiring soon (≤ 3 days, not yet expired) ────────────
      items
        .filter(i => i.expiry_date && i.expiry_date >= today && i.expiry_date <= soonCutoff)
        .forEach(i => {
          const daysLeft = Math.ceil(
            (new Date(i.expiry_date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
          notifications.push({
            id: `expiring-${i.id}`,
            severity: 'warning',
            title: `${i.name} expiring ${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}`,
            body: `Current stock: ${i.current_stock} ${i.unit}. Use or reorder soon.`,
            href: '/dashboard/inventory',
            createdAt: now,
          })
        })

      // ── Low / out of stock ────────────────────────────────────
      items
        .filter(i => i.current_stock <= i.low_stock_threshold)
        .forEach(i => {
          notifications.push({
            id: `lowstock-${i.id}`,
            severity: i.current_stock === 0 ? 'critical' : 'warning',
            title: `${i.name} ${i.current_stock === 0 ? 'is out of stock' : 'is running low'}`,
            body: `${i.current_stock} ${i.unit} remaining (minimum: ${i.low_stock_threshold}).`,
            href: '/dashboard/inventory',
            createdAt: now,
          })
        })

      // ── Stuck orders (pending / confirmed > 30 min) ──────────
      ;(stuckOrdersResult as unknown as { id: string; order_number: string; status: string; created_at: string }[]).forEach((o) => {
        const mins = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000)
        notifications.push({
          id: `stuck-${o.id}`,
          severity: 'warning',
          title: `Order ${o.order_number} is waiting`,
          body: `Status "${o.status}" for ${mins} min — check the barista station.`,
          href: '/dashboard/orders',
          createdAt: now,
        })
      })

      // ── Staff action notifications (menu + inventory) ─────────
      type StaffRow = { id: string; action: string; description: string; created_by: string; created_at: string }
      const inventoryActions = new Set(['ingredient_added', 'ingredient_updated', 'ingredient_deleted', 'stock_updated'])
      staffNotifResult.forEach((n: unknown) => {
        const row = n as StaffRow
        const isInventory = inventoryActions.has(row.action)
        notifications.push({
          id: `staff-${row.id}`,
          severity: 'info',
          title: isInventory ? `Inventory change by ${row.created_by}` : `Menu change by ${row.created_by}`,
          body: row.description,
          href: isInventory ? '/dashboard/inventory' : '/dashboard/menu-manager',
          createdAt: row.created_at,
        })
      })
    }

    // Sort: critical first, then warning, then info
    const ORDER: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 }
    notifications.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])

    return NextResponse.json({ data: notifications, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch notifications'
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
