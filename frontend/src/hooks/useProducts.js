import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../services/api'
import { useNotificationStore } from '../store/notificationStore'

export function useProducts(search = '') {
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['products', search],
    queryFn: () => get(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  })

  useEffect(() => {
    if (lastEvent?.type === 'product_changed') {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    }
  }, [lastEvent, queryClient])

  return query
}
