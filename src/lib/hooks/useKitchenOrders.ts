'use client'
import { useEffect, useRef, useState } from 'react'
import { DEMO_CAFE_ID } from '@/lib/constants'
import type { Order } from '@/lib/types'

const KITCHEN_POLL_MS = 4000
const ORDER_POLL_MS = 5000

export function useKitchenOrders(_cafeId: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders?cafeId=${DEMO_CAFE_ID}&kitchen=true`)
        if (!res.ok) return
        const { data } = await res.json()
        if (!cancelled) setOrders((data as Order[]) ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const id = setInterval(poll, KITCHEN_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { orders, loading }
}

// Hook for customer to track their own order - polls the public order status endpoint
export function useOrderStatus(orderId: string) {
  const [order, setOrder] = useState<Order | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!orderId) return
    doneRef.current = false
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/order/${orderId}`)
        if (!res.ok || cancelled) return
        const { data } = await res.json()
        if (data && !cancelled) {
          setOrder(data as Order)
          if (['completed', 'served', 'cancelled'].includes(data.status)) {
            doneRef.current = true
          }
        }
      } catch { /* network blip - keep polling */ }
    }

    poll()
    const id = setInterval(() => {
      if (!doneRef.current) poll()
    }, ORDER_POLL_MS)

    return () => { cancelled = true; clearInterval(id) }
  }, [orderId])

  return order
}
