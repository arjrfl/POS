import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { useNotificationStore } from '../store/notificationStore'

const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000

// Receiver has no queue room: it never subscribes (see backend/app/routers/ws.py).
const ROLE_ROOM = {
  payment: 'payment-queue',
  releasing: 'releasing-queue',
  admin: 'admin',
}

export function useWebSocket() {
  const token = useAuthStore((state) => state.token)
  const roleName = useAuthStore((state) => state.user?.role_name)
  const setLastEvent = useNotificationStore((state) => state.setLastEvent)
  const queryClient = useQueryClient()

  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const attemptRef = useRef(0)
  const hasConnectedOnceRef = useRef(false)

  const room = ROLE_ROOM[roleName]

  const connect = useCallback(() => {
    if (!room || !token) return

    // Same-origin so this works through the Vite dev proxy (localhost:5173) and
    // through nginx on the LAN (pos.local) without hardcoding a host or port.
    const socket = new WebSocket(`ws://${window.location.host}/ws/${room}?token=${token}`)

    socket.onopen = () => {
      attemptRef.current = 0

      if (hasConnectedOnceRef.current) {
        // Reconnected after a drop: the queue may have missed events, rehydrate it.
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
      hasConnectedOnceRef.current = true
    }

    socket.onmessage = (event) => {
      if (event.data === 'pong') return
      try {
        setLastEvent(JSON.parse(event.data))
      } catch {
        // ignore malformed frames
      }
    }

    socket.onclose = () => {
      // If this socket has already been superseded (a newer connect() call, or
      // an intentional teardown that nulled the ref), it's stale — don't
      // reconnect on its behalf. Without this check, React StrictMode's dev-only
      // mount/cleanup/remount cycle spawns a second, uncancellable reconnect
      // loop from the first socket's late-firing onclose.
      if (socketRef.current !== socket) return

      const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** attemptRef.current, MAX_RECONNECT_DELAY_MS)
      attemptRef.current += 1
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    socketRef.current = socket
  }, [room, token, setLastEvent, queryClient])

  useEffect(() => {
    connect()

    return () => {
      clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [connect])

  return socketRef
}
