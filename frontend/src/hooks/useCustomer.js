import { useQuery } from '@tanstack/react-query'
import { get } from '../services/api'

export function useCustomer(customerId) {
  return useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => get(`/customers/${customerId}`),
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCustomers(search = '') {
  return useQuery({
    queryKey: ['customers', search],
    queryFn: () => get(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    staleTime: 60 * 1000,
  })
}

export function useCustomerLedger(customerId, category, enabled = true) {
  return useQuery({
    queryKey: ['customer-ledger', customerId, category],
    queryFn: () => get(`/customers/${customerId}/ledger?category=${category}`),
    enabled: !!customerId && !!category && enabled,
    staleTime: 60 * 1000,
  })
}
