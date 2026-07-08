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

// The receiver queue is centralized: every receiver member sees the same
// pending_edit/waiting transactions regardless of who created them — no
// walkin_user_id filter here. (The backend's role-based branch for
// "receiver" still ORs in the caller's own transactions server-side so
// GET /transactions stays useful for reference elsewhere, but constraining
// status+queue_status here narrows the result back down to just the queue.)
export function useReceiverQueue() {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['transactions', { status: 'pending_edit', queueStatus: 'waiting' }],
    queryFn: () => get('/transactions?status=pending_edit&queue_status=waiting&page_size=100'),
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!lastEvent) return
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
  }, [lastEvent, queryClient])

  return query
}
