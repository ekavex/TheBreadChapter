'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Cart, CartItem, MenuItem } from '@/lib/types'

interface CartStore {
  cart: Cart | null
  // Actions
  initCart: (cafeId: string, tableId: string, tableNumber: number) => void
  addItem: (item: MenuItem, quantity?: number, customisation?: string) => void
  removeItem: (menuItemId: string) => void
  updateQuantity: (menuItemId: string, quantity: number) => void
  clearCart: () => void
  // Computed
  itemCount: () => number
  subtotal: () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      cart: null,

      initCart: (cafeId, tableId, tableNumber) => {
        const existing = get().cart
        // Don't overwrite if same table
        if (existing?.tableId === tableId) return
        set({ cart: { cafeId, tableId, tableNumber, items: [] } })
      },

      addItem: (menuItem, quantity = 1, customisation) => {
        set(state => {
          if (!state.cart) return state
          const existing = state.cart.items.find(i => i.menuItem.id === menuItem.id)
          if (existing) {
            return {
              cart: {
                ...state.cart,
                items: state.cart.items.map(i =>
                  i.menuItem.id === menuItem.id
                    ? { ...i, quantity: i.quantity + quantity }
                    : i
                ),
              },
            }
          }
          return {
            cart: {
              ...state.cart,
              items: [...state.cart.items, { menuItem, quantity, customisation }],
            },
          }
        })
      },

      removeItem: (menuItemId) => {
        set(state => ({
          cart: state.cart
            ? { ...state.cart, items: state.cart.items.filter(i => i.menuItem.id !== menuItemId) }
            : null,
        }))
      },

      updateQuantity: (menuItemId, quantity) => {
        if (quantity <= 0) { get().removeItem(menuItemId); return }
        set(state => ({
          cart: state.cart
            ? {
                ...state.cart,
                items: state.cart.items.map(i =>
                  i.menuItem.id === menuItemId ? { ...i, quantity } : i
                ),
              }
            : null,
        }))
      },

      clearCart: () => set({ cart: null }),

      itemCount: () => get().cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0,

      subtotal: () =>
        get().cart?.items.reduce((sum, i) => sum + i.menuItem.price * i.quantity, 0) ?? 0,
    }),
    { name: 'cafe-cart', skipHydration: true }
  )
)
