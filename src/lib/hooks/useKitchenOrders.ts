'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/lib/types'

export function useKitchenOrders(cafeId: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    // Initial fetch — orders that have been sent to kitchen (KOT sent or beyond)
    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*), table:tables(number, label)')
        .eq('cafe_id', cafeId)
        .in('status', ['pending', 'confirmed', 'making', 'ready'])
        .not('pos_status', 'eq', 'OPEN')
        .order('created_at', { ascending: true })
      setOrders((data as Order[]) ?? [])
      setLoading(false)
    }

    fetchOrders()

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`kitchen:${cafeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `cafe_id=eq.${cafeId}` },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            // Only add to kitchen if KOT has been sent (not a fresh empty order)
            if (payload.new.pos_status === 'OPEN') return
            const { data } = await supabase
              .from('orders')
              .select('*, items:order_items(*), table:tables(number, label)')
              .eq('id', payload.new.id)
              .single()
            if (data) setOrders(prev => [...prev, data as Order])
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Order
            if (['completed', 'cancelled', 'served'].includes(updated.status)) {
              setOrders(prev => prev.filter(o => o.id !== updated.id))
            } else if (updated.pos_status === 'OPEN') {
              // Still a draft — not for kitchen
            } else {
              // Order is already in the list → update it; if it just arrived
              // (transitioned OPEN → KOT_SENT), fetch full row and append.
              setOrders(prev => {
                const exists = prev.some(o => o.id === updated.id)
                if (exists) return prev.map(o => o.id === updated.id ? { ...o, ...updated } : o)
                // Newly kitchen-visible — fetch full order with items and add
                supabase
                  .from('orders')
                  .select('*, items:order_items(*), table:tables(number, label)')
                  .eq('id', updated.id)
                  .single()
                  .then(({ data }) => {
                    if (data) setOrders(p => [...p, data as Order])
                  })
                return prev
              })
            }
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cafeId])

  return { orders, loading }
}

// Hook for customer to track their own order
export function useOrderStatus(orderId: string) {
  const [order, setOrder] = useState<Order | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!orderId) return

    const fetch = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('id', orderId)
        .single()
      setOrder(data as Order)
    }

    fetch()

    const channel = supabase
      .channel(`order:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => setOrder(prev => prev ? { ...prev, ...payload.new } : null)
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orderId])

  return order
}
