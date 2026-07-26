import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNotificationStore } from '../store/notificationStore'

const DEBOUNCE_MS = 400

// Receiver's dedicated 'receiver'-room WebSocket connection (see
// useWebSocket.js, mounted once in PageLayout) receives product_changed
// broadcasts whenever Releasing's or Admin's Inventory tab creates, edits,
// adjusts stock on, toggles status of, or deletes a product. Debounced the
// same way useAdminLiveSync debounces its own product_changed handling, so a
// burst of edits (e.g. several stock adjustments back to back) triggers one
// refetch of the Product Stock panel instead of one per event.
export function useReceiverLiveSync() {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)
  const timerRef = useRef(null)

  useEffect(() => {
    if (lastEvent?.type !== 'product_changed') return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    }, DEBOUNCE_MS)
  }, [lastEvent, queryClient])

  useEffect(() => () => clearTimeout(timerRef.current), [])
}
