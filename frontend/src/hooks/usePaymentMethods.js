import { useQuery } from '@tanstack/react-query'
import { get } from '../services/api'

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => get('/payment-methods'),
    staleTime: Infinity,
  })
}
