import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../services/api'
import { useNotificationStore } from '../store/notificationStore'

// A transaction_status_changed event reaches a room whenever its old OR new
// status belongs to that room (see backend/app/websocket/events.py) — so it
// fires both for arrivals (e.g. new_status = 'pending_payment') and for
// departures (e.g. old_status = 'pending_payment', new_status = 'completed').
// A queue_status_changed event only reaches a room that already owns the
// transaction. Either way, any event this queue's socket receives is relevant,
// regardless of what the new_status happens to be.
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

    if (
      lastEvent.type === 'transaction_status_changed' ||
      lastEvent.type === 'queue_status_changed' ||
      lastEvent.type === 'transaction_items_changed'
    ) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    }
  }, [lastEvent, queryClient])

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
