import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { get } from '../../services/api'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'
import { getDisplayStatus, isViewablePaymentStatus, PAYMENT_STATUS_LABELS } from '../../utils/transactionStatus'
import { getTransactionTypeLabel } from '../../utils/transactionType'
import { TransactionDetailsModal } from './TransactionDetailsModal'

// Options mirror the same payment_status bucket the Status column itself
// renders via getDisplayStatus — filtering and display always agree.
const PAYMENT_STATUSES = ['pending', 'full', 'partial', 'voided']
const SELECT_CLASSES =
  'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light text-sm'

function CustomerSearchFilter({ value, onChange }) {
  return (
    <Input
      id="tx-customer-search"
      label="Customer / Order #"
      placeholder="Search by name or order #..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  )
}

function TransactionRow({ transaction, onViewDetails }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const { status: paymentStatus, label: paymentStatusLabel } = getDisplayStatus(transaction)
  const isViewable = isViewablePaymentStatus(paymentStatus)

  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm font-medium text-gray-900">{transaction.order_number}</td>
      <td className="px-3 py-2 text-sm text-gray-700">{customer?.full_name ?? '...'}</td>
      <td className="px-3 py-2 text-sm text-gray-600 text-center">{getTransactionTypeLabel(transaction.transaction_type)}</td>
      <td className="px-3 py-2 text-center">
        <Badge status={paymentStatus}>{paymentStatusLabel}</Badge>
      </td>
      <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(transaction.total_due)}</td>
      <td className="px-3 py-2 text-sm text-gray-700 text-center">
        {transaction.payment_user_name ?? <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 text-center">{new Date(transaction.created_at).toLocaleString()}</td>
      <td className="px-3 py-2 text-center">
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1 text-xs"
          disabled={!isViewable}
          title={isViewable ? undefined : 'Available once payment is processed'}
          onClick={() => onViewDetails(transaction.id)}
        >
          View Details
        </Button>
      </td>
    </tr>
  )
}

function PaymentUserFilter({ value, onChange }) {
  const { data: paymentUsers } = useQuery({
    queryKey: ['users', 'payment'],
    queryFn: () => get('/users?role=payment&status=active'),
  })

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="tx-payment-user" className="text-sm font-medium text-gray-700">
        Payment
      </label>
      <select
        id="tx-payment-user"
        className={SELECT_CLASSES}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">All payment users</option>
        {paymentUsers?.map((user) => (
          <option key={user.id} value={user.id}>
            {user.full_name}
          </option>
        ))}
      </select>
    </div>
  )
}

const DEFAULT_FILTERS = {
  status: '',
  customerType: '',
  search: '',
  paymentUserId: null,
  dateFrom: '',
  dateTo: '',
}

export function TransactionsSection() {
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [viewingTransactionId, setViewingTransactionId] = useState(null)

  const setDraftField = (field, value) => setDraftFilters((prev) => ({ ...prev, [field]: value }))

  const handleRun = () => {
    setAppliedFilters(draftFilters)
    setPage(1)
  }

  const handleClear = () => {
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
    setPage(1)
  }

  const { data, isLoading } = useTransactions({
    paymentStatus: appliedFilters.status || undefined,
    customerType: appliedFilters.customerType || undefined,
    search: appliedFilters.search || undefined,
    paymentUserId: appliedFilters.paymentUserId || undefined,
    dateFrom: appliedFilters.dateFrom || undefined,
    dateTo: appliedFilters.dateTo || undefined,
    page,
    pageSize: 20,
    includePaymentStatus: true,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1

  return (
    <div className="h-full flex gap-6 min-h-0">
      <div className="w-[300px] shrink-0 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Filter Fields</span>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="tx-status" className="text-sm font-medium text-gray-700">
              Status
            </label>
            <select
              id="tx-status"
              className={SELECT_CLASSES}
              value={draftFilters.status}
              onChange={(e) => setDraftField('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-customer-type" className="text-sm font-medium text-gray-700">
              Customer type
            </label>
            <select
              id="tx-customer-type"
              className={SELECT_CLASSES}
              value={draftFilters.customerType}
              onChange={(e) => setDraftField('customerType', e.target.value)}
            >
              <option value="">All types</option>
              <option value="walk_in">Walk-In</option>
              <option value="online">Online</option>
            </select>
          </div>

          <PaymentUserFilter
            value={draftFilters.paymentUserId}
            onChange={(value) => setDraftField('paymentUserId', value)}
          />

          <Input
            id="tx-date-from"
            label="From"
            type="date"
            className="w-full"
            value={draftFilters.dateFrom}
            onChange={(e) => setDraftField('dateFrom', e.target.value)}
          />
          <Input
            id="tx-date-to"
            label="To"
            type="date"
            className="w-full"
            value={draftFilters.dateTo}
            onChange={(e) => setDraftField('dateTo', e.target.value)}
          />

          <CustomerSearchFilter value={draftFilters.search} onChange={(value) => setDraftField('search', value)} />

          <div className="flex gap-2 mt-1">
            <Button type="button" variant="primary" className="flex-1" onClick={handleRun}>
              Run
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Transaction History</span>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg">
          <table className="table-auto w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-300 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Total Due</th>
                <th className="px-3 py-2 text-center">Payment</th>
                <th className="px-3 py-2 text-center">Created</th>
                <th className="px-3 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-sm text-gray-500">
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-sm text-gray-500">
                    No transactions match these filters.
                  </td>
                </tr>
              )}
              {!isLoading &&
                data?.items.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} onViewDetails={setViewingTransactionId} />
                ))}
            </tbody>
          </table>
        </div>

        {data && data.total > 20 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 shrink-0">
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages} ({data.total} total)
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {viewingTransactionId && (
        <TransactionDetailsModal
          transactionId={viewingTransactionId}
          onClose={() => setViewingTransactionId(null)}
          onNavigate={setViewingTransactionId}
        />
      )}
    </div>
  )
}
