import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../services/api'
import { useNotificationStore } from '../store/notificationStore'

// A transaction_status_changed event only reaches a room when its new_status
// enters that room's queue (see backend/app/websocket/events.py); a
// queue_status_changed event only reaches a room that already owns the
// transaction. Either way, any event this queue's socket receives is relevant.
function useStatusQueue(status) {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['transactions', { status }],
    queryFn: () => get(`/transactions?status=${status}`),
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!lastEvent) return

    const isNewArrival = lastEvent.type === 'transaction_status_changed' && lastEvent.new_status === status
    const isQueueStatusChange = lastEvent.type === 'queue_status_changed'

    if (isNewArrival || isQueueStatusChange) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    }
  }, [lastEvent, status, queryClient])

  return query
}

export function usePaymentQueue() {
  return useStatusQueue('pending_payment')
}

export function useReleasingQueue() {
  return useStatusQueue('pending_settlement')
}

// Admin's queue monitor watches both queues at once and cares about a
// transaction leaving a status just as much as arriving — e.g. a
// pending_payment -> completed transition matters here even though it isn't
// a "new arrival" for either queue. The admin room receives every event
// (see backend/app/websocket/events.py's ADMIN_ROOM cc), so any event at all
// is a reasonable reason to refresh this specific view.
export function useAdminQueue(status) {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['transactions', { status }],
    queryFn: () => get(`/transactions?status=${status}`),
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!lastEvent) return
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
  }, [lastEvent, queryClient])

  return query
}

// The receiver role's own GET /transactions filter is server-driven (see
// app/routers/transactions.py): it returns their own created transactions
// PLUS every pending_edit transaction regardless of creator, in one response.
// Like admin, that's two cross-cutting criteria rather than one status, so
// any event on the receiver-queue room is a reasonable reason to refresh.
export function useReceiverQueue() {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['transactions', { receiverQueue: true }],
    queryFn: () => get('/transactions?page_size=100'),
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!lastEvent) return
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
  }, [lastEvent, queryClient])

  return query
}
