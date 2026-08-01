import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNotificationStore } from '../store/notificationStore'

const DEBOUNCE_MS = 400

// Operations' single 'operations'-room WebSocket connection (see useWebSocket.js,
// mounted once in PageLayout) receives product_changed (manual Inventory CRUD)
// and product_stock_changed (routine sale-driven decrements — see
// backend/app/websocket/events.py) broadcasts. Debounced the same way
// useReceiverLiveSync/useAdminLiveSync debounce their own product event
// handling, so a burst of stock ticks (e.g. a multi-item transaction
// completing) triggers one refetch instead of one per event.
export function useOperationsLiveSync() {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)
  const timerRef = useRef(null)

  useEffect(() => {
    if (lastEvent?.type !== 'product_changed' && lastEvent?.type !== 'product_stock_changed') return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    }, DEBOUNCE_MS)
  }, [lastEvent, queryClient])

  useEffect(() => () => clearTimeout(timerRef.current), [])
}
