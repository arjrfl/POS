import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { get } from '../../services/api'
import { TransactionChainDetails } from './TransactionChainDetails'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

const STATUSES = ['pending_payment', 'pending_settlement', 'settled', 'completed', 'voided']
const SELECT_CLASSES =
  'px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light text-sm'

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

export function TransactionsSection() {
  const [status, setStatus] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1)
  }, [status, customerType, selectedCustomer, dateFrom, dateTo])

  const { data, isLoading } = useTransactions({
    status: status || undefined,
    customerType: customerType || undefined,
    customerId: selectedCustomer?.id,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 20,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1

  const handleToggle = (id) => {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="tx-status" className="text-sm font-medium text-gray-700">
              Status
            </label>
            <select id="tx-status" className={SELECT_CLASSES} value={status} onChange={(e) => setStatus(e.target.value)}>
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
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}
            >
              <option value="">All types</option>
              <option value="walk_in">Walk-In</option>
              <option value="online">Online</option>
            </select>
          </div>

          <Input id="tx-date-from" label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input id="tx-date-to" label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />

          <CustomerSearchFilter
            selectedCustomer={selectedCustomer}
            onSelect={setSelectedCustomer}
            onClear={() => setSelectedCustomer(null)}
          />
        </div>
      </Card>

      <Card>
        {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
        {!isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
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
                {data?.items.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    isExpanded={expandedId === transaction.id}
                    onToggle={handleToggle}
                  />
                ))}
              </tbody>
            </table>
            {data?.items.length === 0 && <p className="text-gray-500 text-sm py-4">No transactions match these filters.</p>}
          </div>
        )}

        {data && data.total > 20 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200">
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
      </Card>
    </div>
  )
}
