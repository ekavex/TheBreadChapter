'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/lib/types'

export function useKitchenOrders(cafeId: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    // Initial fetch — active orders only
    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*), table:tables(number, label)')
        .eq('cafe_id', cafeId)
        .in('status', ['pending', 'confirmed', 'making', 'ready'])
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
            // Fetch the full order with items
            const { data } = await supabase
              .from('orders')
              .select('*, items:order_items(*), table:tables(number, label)')
              .eq('id', payload.new.id)
              .single()
            if (data) setOrders(prev => [...prev, data as Order])
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Order
            // Remove from list if completed/cancelled
            if (['completed', 'cancelled', 'served'].includes(updated.status)) {
              setOrders(prev => prev.filter(o => o.id !== updated.id))
            } else {
              setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))
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
