import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNotificationStore } from '../store/notificationStore'

const DEBOUNCE_MS = 400

// Admin's single 'admin'-room WebSocket connection (see useWebSocket.js, mounted
// once in PageLayout) already receives every transaction_status_changed and
// queue_status_changed event globally (backend/app/websocket/events.py ccs
// ADMIN_ROOM on every status/queue transition, including transaction creation).
// Dashboard/Transaction History/Customer Detail all key their queries off the
// shared 'transactions' prefix (see useTransactions.js), but none of those
// components stay mounted across every Admin tab — this hook is mounted once
// at the Admin page level (independent of which tab is active) so live
// updates land no matter which section the user is looking at. Debounced so a
// burst of events (e.g. several substandard resolutions back to back) triggers
// one refetch instead of one per event.
export function useAdminLiveSync() {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)
  const timerRef = useRef(null)

  useEffect(() => {
    const isQueueEvent = lastEvent?.type === 'transaction_status_changed' || lastEvent?.type === 'queue_status_changed'
    const isProductEvent = lastEvent?.type === 'product_changed'
    if (!isQueueEvent && !isProductEvent) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (isQueueEvent) {
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'top-products'] })
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'summary'] })
    }, DEBOUNCE_MS)
  }, [lastEvent, queryClient])

  useEffect(() => () => clearTimeout(timerRef.current), [])
}
