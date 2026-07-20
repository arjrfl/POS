import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { get } from '../../services/api'
import { TransactionChainDetails } from './TransactionChainDetails'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

const STATUSES = ['pending_payment', 'pending_settlement', 'settled', 'completed', 'voided']
const SELECT_CLASSES =
  'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light text-sm'

function CustomerSearchFilter({ selectedCustomer, onSelect, onClear }) {
  const [term, setTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const { data: matches } = useQuery({
    queryKey: ['customers', term],
    queryFn: () => get(`/customers?search=${encodeURIComponent(term)}`),
    enabled: isOpen && term.trim().length > 0,
  })

  if (selectedCustomer) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">Customer</span>
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm">
          <span className="text-gray-900">{selectedCustomer.full_name}</span>
          <button type="button" onClick={onClear} className="ml-auto text-gray-400 hover:text-gray-600" aria-label="Clear customer filter">
            &#10005;
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <Input
        id="tx-customer-search"
        label="Customer"
        placeholder="Search by name..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        autoComplete="off"
      />
      {isOpen && term.trim() && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {matches?.length ? (
            matches.map((customer) => (
              <button
                type="button"
                key={customer.id}
                onMouseDown={() => onSelect(customer)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-sm"
              >
                {customer.full_name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500">No matches.</div>
          )}
        </div>
      )}
    </div>
  )
}

function TransactionRow({ transaction, isExpanded, onToggle }) {
  const { data: customer } = useCustomer(transaction.customer_id)

  return (
    <>
      <tr
        className="border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50"
        onClick={() => onToggle(transaction.id)}
      >
        <td className="px-3 py-2 text-sm font-medium text-gray-900">{transaction.order_number}</td>
        <td className="px-3 py-2 text-sm text-gray-700">{customer?.full_name ?? '...'}</td>
        <td className="px-3 py-2 text-sm text-gray-600 capitalize">{transaction.customer_type.replace('_', ' ')}</td>
        <td className="px-3 py-2">
          <Badge status={transaction.transaction_status} />
        </td>
        <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(transaction.total_due)}</td>
        <td className="px-3 py-2 text-sm text-gray-500">{new Date(transaction.created_at).toLocaleString()}</td>
        <td className="px-3 py-2 text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <TransactionChainDetails transactionId={transaction.id} />
          </td>
        </tr>
      )}
    </>
  )
}

const DEFAULT_FILTERS = { status: '', customerType: '', selectedCustomer: null, dateFrom: '', dateTo: '' }

export function TransactionsSection() {
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)

  const setDraftField = (field, value) => setDraftFilters((prev) => ({ ...prev, [field]: value }))

  const handleRun = () => {
    setAppliedFilters(draftFilters)
    setPage(1)
  }

  const { data, isLoading } = useTransactions({
    status: appliedFilters.status || undefined,
    customerType: appliedFilters.customerType || undefined,
    customerId: appliedFilters.selectedCustomer?.id,
    dateFrom: appliedFilters.dateFrom || undefined,
    dateTo: appliedFilters.dateTo || undefined,
    page,
    pageSize: 20,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1

  const handleToggle = (id) => {
    setExpandedId((current) => (current === id ? null : id))
  }

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
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
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

          <CustomerSearchFilter
            selectedCustomer={draftFilters.selectedCustomer}
            onSelect={(customer) => setDraftField('selectedCustomer', customer)}
            onClear={() => setDraftField('selectedCustomer', null)}
          />

          <Button type="button" variant="primary" className="w-full mt-1" onClick={handleRun}>
            Run
          </Button>
        </div>
      </div>

      <div className="flex-1 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Transaction History Table</span>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg">
          <table className="table-auto w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-300 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total Due</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-sm text-gray-500">
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-sm text-gray-500">
                    No transactions match these filters.
                  </td>
                </tr>
              )}
              {!isLoading &&
                data?.items.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    isExpanded={expandedId === transaction.id}
                    onToggle={handleToggle}
                  />
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
    </div>
  )
}
