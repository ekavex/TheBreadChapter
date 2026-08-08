import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireDashboardSession } from '@/lib/auth/requireDashboardSession'
import { paymentProvider } from '@/lib/payment/MockPaymentProvider'
import { finalizeApprovedPayment } from '@/lib/payment/finalize'
import { DEMO_STORE_ID } from '@/lib/constants'
import { logger } from '@/lib/logger'
import type { Order, Payment, Terminal } from '@/lib/types'
import type { PaymentResult } from '@/lib/payment/types'

type Supabase = ReturnType<typeof createAdminClient>

const ALLOWED_MODE_CODE: Record<'card' | 'cash' | 'upi', string> = { card: '1', cash: '2', upi: '10' }
const ORDER_WITH_ITEMS_AND_TABLE = '*, items:order_items(*), table:tables(*)'

function toJson(value: unknown) { return JSON.parse(JSON.stringify(value)) }

async function latestPaymentFor(supabase: Supabase, orderId: string) {
  const { data } = await supabase
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as Payment | null
}


// Offline-payment behavior: an order can be left in AWAITING_PAYMENT if the
// network/terminal drops between charge() and the PAID transition. Rather
// than firing a second charge (double-charge risk), poll the existing
// payment's status and finalize/fail from that — never re-charge here.
async function reconcileAwaitingPayment(
  supabase: Supabase,
  order: Order,
  terminal: Terminal,
  customerPhone: string | null | undefined,
  customerName: string | null | undefined
) {
  const payment = await latestPaymentFor(supabase, order.id)

  if (!payment?.plutus_ptrid) {
    // No charge was ever recorded (e.g. charge() itself threw before the
    // payment row was inserted) — nothing to reconcile against. Fail it back
    // to a retryable state instead of leaving the order stuck forever.
    logger.warn('payment.reconcile.no_pending_payment', { orderId: order.id })
    const { data: failedOrder } = await supabase
      .from('orders')
      .update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' })
      .eq('id', order.id)
      .select(ORDER_WITH_ITEMS_AND_TABLE)
      .single()
    return { order: (failedOrder as Order) ?? order, payment }
  }

  logger.info('payment.reconcile.start', { orderId: order.id, ptrid: payment.plutus_ptrid })
  const statusResult = await paymentProvider.status(payment.plutus_ptrid, {
    clientId: payment.client_id ?? terminal.client_id,
    storeId: payment.store_id ?? DEMO_STORE_ID,
  })
  logger.info('payment.reconcile.result', { orderId: order.id, ptrid: payment.plutus_ptrid, status: statusResult.status })

  if (statusResult.status === 'approved') {
    return finalizeApprovedPayment(supabase, order, payment, statusResult, customerPhone, customerName)
  }

  if (statusResult.status === 'pending') {
    // Terminal/network still hasn't settled — leave it AWAITING_PAYMENT so
    // the waiter can check again shortly rather than treating it as failed.
    return { order, payment }
  }

  await supabase
    .from('payments')
    .update({ status: statusResult.status === 'cancelled' ? 'cancelled' : 'declined', raw_response: toJson(statusResult) })
    .eq('id', payment.id)

  const { data: failedOrder } = await supabase
    .from('orders')
    .update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' })
    .eq('id', order.id)
    .select(ORDER_WITH_ITEMS_AND_TABLE)
    .single()

  return { order: (failedOrder as Order) ?? order, payment: { ...payment, status: statusResult.status } as Payment }
}

// POST /api/pos/orders/[id]/pay — Module 5 §9: UploadBilledTransaction (charge)
// then GetStatus (status) against the PaymentProvider abstraction. On approval:
// idempotent finalize — deduct ingredient stock per recipe, mark PAID, release
// the table. On decline: PAYMENT_FAILED, table stays billed so the waiter can
// retry. See reconcileAwaitingPayment for the crash/offline-retry path.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionGuard = await requireDashboardSession(req)
  if (sessionGuard) return sessionGuard

  try {
    const body = await req.json().catch(() => ({}))
    const { mode, customer_phone, customer_name } = body as {
      mode?: string
      customer_phone?: string | null
      customer_name?: string | null
    }

    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_AND_TABLE)
      .eq('id', params.id)
      .single()
    if (orderError || !order) return NextResponse.json({ data: null, error: 'Order not found' }, { status: 404 })
    const typedOrder = order as Order

    const { data: terminal } = await supabase.from('terminals').select('*').limit(1).maybeSingle()
    if (!terminal) return NextResponse.json({ data: null, error: 'No payment terminal configured' }, { status: 500 })

    if (typedOrder.pos_status === 'PAID') {
      const payment = await latestPaymentFor(supabase, typedOrder.id)
      return NextResponse.json({ data: { order: typedOrder, payment }, error: null })
    }

    if (typedOrder.pos_status === 'AWAITING_PAYMENT') {
      const result = await reconcileAwaitingPayment(supabase, typedOrder, terminal as Terminal, customer_phone, customer_name)
      return NextResponse.json({ data: result, error: null })
    }

    if (!['BILLED', 'PAYMENT_FAILED'].includes(typedOrder.pos_status)) {
      return NextResponse.json({ data: null, error: `Cannot take payment on an order that is ${typedOrder.pos_status}` }, { status: 409 })
    }
    if (!mode || !['card', 'cash', 'upi'].includes(mode)) {
      return NextResponse.json({ data: null, error: 'mode must be "card", "cash" or "upi"' }, { status: 400 })
    }

    // Atomic claim — a double-click or a concurrent retry racing this same
    // request must not both pass the BILLED/PAYMENT_FAILED check and fire two
    // charges. Whoever's UPDATE actually matches a row wins the charge.
    const { data: claimedOrder } = await supabase
      .from('orders')
      .update({ pos_status: 'AWAITING_PAYMENT' })
      .eq('id', params.id)
      .in('pos_status', ['BILLED', 'PAYMENT_FAILED'])
      .select(ORDER_WITH_ITEMS_AND_TABLE)
      .maybeSingle()

    if (!claimedOrder) {
      const { data: fresh } = await supabase.from('orders').select(ORDER_WITH_ITEMS_AND_TABLE).eq('id', params.id).single()
      const freshOrder = fresh as Order | null
      if (freshOrder?.pos_status === 'AWAITING_PAYMENT') {
        const result = await reconcileAwaitingPayment(supabase, freshOrder, terminal as Terminal, customer_phone, customer_name)
        return NextResponse.json({ data: result, error: null })
      }
      if (freshOrder?.pos_status === 'PAID') {
        const payment = await latestPaymentFor(supabase, freshOrder.id)
        return NextResponse.json({ data: { order: freshOrder, payment }, error: null })
      }
      return NextResponse.json(
        { data: null, error: 'Payment already in progress on this order — refresh and retry' },
        { status: 409 }
      )
    }

    const claimed = claimedOrder as Order
    const transactionNumber = `${claimed.order_number}-${Date.now()}`
    logger.info('payment.charge.start', { orderId: claimed.id, transactionNumber, amountPaisa: claimed.total_paisa, mode })

    let chargeResult: PaymentResult
    try {
      chargeResult = await paymentProvider.charge({
        transactionNumber,
        amountPaisa: claimed.total_paisa,
        allowedModes: ALLOWED_MODE_CODE[mode as 'card' | 'cash' | 'upi'],
        clientId: terminal.client_id,
        storeId: DEMO_STORE_ID,
      })
    } catch (chargeErr) {
      // Network/terminal drop mid-charge, before any payment row exists.
      // Fail it back to a retryable state rather than leaving it claimed
      // forever — a retry will start a clean new charge.
      const message = chargeErr instanceof Error ? chargeErr.message : String(chargeErr)
      logger.error('payment.charge.error', { orderId: claimed.id, transactionNumber, error: message })
      await supabase.from('orders').update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' }).eq('id', params.id)
      throw chargeErr
    }
    logger.info('payment.charge.result', { orderId: claimed.id, transactionNumber, ptrid: chargeResult.ptrid, status: chargeResult.status })

    const { data: payment, error: paymentInsertError } = await supabase
      .from('payments')
      .insert({
        order_id: params.id,
        transaction_number: transactionNumber,
        plutus_ptrid: chargeResult.ptrid ?? null,
        status: 'initiated',
        mode: chargeResult.mode ?? null,
        amount_paisa: claimed.total_paisa,
        client_id: terminal.client_id,
        store_id: DEMO_STORE_ID,
        raw_response: toJson(chargeResult),
      })
      .select()
      .single()
    if (paymentInsertError) throw paymentInsertError

    logger.info('payment.status.start', { orderId: claimed.id, ptrid: chargeResult.ptrid })
    const statusResult = chargeResult.ptrid
      ? await paymentProvider.status(chargeResult.ptrid, { clientId: terminal.client_id, storeId: DEMO_STORE_ID })
      : chargeResult
    logger.info('payment.status.result', { orderId: claimed.id, ptrid: chargeResult.ptrid, status: statusResult.status })

    if (statusResult.status === 'approved') {
      const result = await finalizeApprovedPayment(supabase, claimed, payment as Payment, statusResult, customer_phone, customer_name)
      return NextResponse.json({ data: result, error: null })
    }

    // declined / cancelled / pending-but-unresolved
    logger.warn('payment.declined', { orderId: claimed.id, ptrid: chargeResult.ptrid, status: statusResult.status })
    await supabase
      .from('payments')
      .update({ status: statusResult.status === 'cancelled' ? 'cancelled' : 'declined', raw_response: toJson(statusResult) })
      .eq('id', payment.id)

    const { data: failedOrder, error: failedError } = await supabase
      .from('orders')
      .update({ pos_status: 'PAYMENT_FAILED', payment_status: 'failed' })
      .eq('id', params.id)
      .select(ORDER_WITH_ITEMS_AND_TABLE)
      .single()
    if (failedError) throw failedError

    return NextResponse.json({ data: { order: failedOrder, payment: { ...payment, status: statusResult.status } }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed'
    logger.error('payment.route.error', { orderId: params.id, error: message })
    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}
