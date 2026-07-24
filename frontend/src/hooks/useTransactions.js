import { useQuery } from '@tanstack/react-query'
import { get } from '../services/api'

// Generic filtered/paginated transaction list — the admin dashboard, the
// transactions table, and a customer's transaction history all just need
// different slices of GET /transactions, so they all go through here.
export function useTransactions(filters = {}) {
  const {
    status,
    paymentStatus,
    customerType,
    customerId,
    paymentUserId,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20,
    enabled = true,
    includePaymentStatus = false,
  } = filters

  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (paymentStatus) params.set('payment_status', paymentStatus)
  if (customerType) params.set('customer_type', customerType)
  if (customerId) params.set('customer_id', customerId)
  if (paymentUserId) params.set('payment_user_id', paymentUserId)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  if (includePaymentStatus) params.set('include_payment_status', 'true')
  params.set('page', String(page))
  params.set('page_size', String(pageSize))

  const queryString = params.toString()

  return useQuery({
    // Nested under the same 'transactions' prefix the queue hooks already
    // invalidate on relevant WebSocket events (see useQueue.js) — react-query
    // matches invalidateQueries({queryKey: ['transactions']}) by prefix, so
    // this view refreshes on live events too without any new WS wiring.
    queryKey: [
      'transactions',
      'list',
      {
        status,
        paymentStatus,
        customerType,
        customerId,
        paymentUserId,
        dateFrom,
        dateTo,
        page,
        pageSize,
        includePaymentStatus,
      },
    ],
    queryFn: () => get(`/transactions?${queryString}`),
    enabled,
    staleTime: 30 * 1000,
  })
}
