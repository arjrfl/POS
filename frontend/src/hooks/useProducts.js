import { useQuery } from '@tanstack/react-query'
import { get } from '../services/api'

export function useProducts(search = '') {
  return useQuery({
    queryKey: ['products', search],
    queryFn: () => get(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  })
}
