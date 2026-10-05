// Extra details printed on a customer bill, shared by the thermal bill (sent to
// the Android print bridge via /api/pos/print-jobs) and the downloadable HTML
// receipt so the two never disagree.
import type postgres from 'postgres'

type SqlClient = postgres.Sql<any>

export interface BillPrintDetails {
  billNumber: string | null    // TBC/26-27/0001 - null for orders billed before bill numbers existed
  orderNumber: string | null   // ORD-0042
  staffName: string | null     // waiter who sent the order's first KOT
  fssaiNumber: string | null   // only when an admin has set one
  paid: boolean
  paymentMode: 'UPI' | 'CARD' | 'CASH' | null
  paymentRef: string | null    // bank RRN or terminal transaction id; none for cash
}

const PAYMENT_MODE_LABEL: Record<string, BillPrintDetails['paymentMode']> = {
  upi: 'UPI',
  card: 'CARD',
  cash: 'CASH',
}

export async function getBillPrintDetails(sql: SqlClient, orderId: string): Promise<BillPrintDetails | null> {
  const [row] = await sql`
    SELECT
      o.bill_number,
      o.order_number,
      o.pos_status,
      o.payment_method,
      NULLIF(btrim(c.settings->>'fssai_number'), '') AS fssai_number,
      (
        SELECT k.taken_by FROM kot_tickets k
        WHERE k.order_id = o.id AND k.job_type = 'kot' AND k.taken_by IS NOT NULL
        ORDER BY k.printed_at ASC
        LIMIT 1
      ) AS staff_name,
      (
        SELECT COALESCE(p.rrn, p.plutus_ptrid) FROM payments p
        WHERE p.order_id = o.id AND p.status = 'approved'
        ORDER BY p.created_at DESC
        LIMIT 1
      ) AS payment_ref
    FROM orders o
    LEFT JOIN cafes c ON c.id = o.cafe_id
    WHERE o.id = ${orderId}
  `
  if (!row) return null

  const paid = row.pos_status === 'PAID'
  return {
    billNumber: (row.bill_number as string | null) ?? null,
    orderNumber: (row.order_number as string | null) ?? null,
    staffName: (row.staff_name as string | null) ?? null,
    fssaiNumber: (row.fssai_number as string | null) ?? null,
    paid,
    paymentMode: paid ? PAYMENT_MODE_LABEL[row.payment_method as string] ?? null : null,
    paymentRef: paid ? (row.payment_ref as string | null) ?? null : null,
  }
}
