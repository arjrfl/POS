import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

const fetchTransactionHistory = () => get('/transactions/history')

const CHILD_TYPE_BADGE = {
  adjustment: { label: 'ADJUSTMENT', className: 'bg-purple-100 text-purple-800' },
  refund: { label: 'REFUND', className: 'bg-pink-100 text-pink-800' },
}

function HistoryCard({ transaction }) {
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const childBadge = CHILD_TYPE_BADGE[transaction.transaction_type]

  return (
    <div className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-md mb-1 bg-white">
      <div className="flex-none w-56">
        <div className="font-mono font-bold text-base text-gray-900 truncate">{transaction.order_number}</div>
        <div className="text-sm text-gray-600 truncate">{transaction.customer_name}</div>
        {transaction.parent_order_number && childBadge && (
          <div className="mt-1 flex items-center gap-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${childBadge.className}`}
            >
              {childBadge.label}
            </span>
            <span className="text-xs text-gray-500">Linked to: {transaction.parent_order_number}</span>
          </div>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center gap-2">
        {typeBadge && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        )}
      </div>

      <div className="flex-none text-right w-44 mr-20">
        <div className="text-sm text-gray-400 whitespace-nowrap">{new Date(transaction.finished_at).toLocaleString()}</div>
      </div>

      <div className="flex-none text-right w-28">
        <div className="font-bold text-base text-primary whitespace-nowrap">{formatCurrency(transaction.total_due)}</div>
      </div>
    </div>
  )
}

export function TransactionHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'history'],
    queryFn: fetchTransactionHistory,
  })

  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const runSearch = () => setSearchTerm(searchInput.trim().toLowerCase())

  const filteredData = useMemo(() => {
    if (!data) return data
    if (!searchTerm) return data
    return data.filter((transaction) => {
      const orderNumber = transaction.order_number?.toLowerCase() ?? ''
      const customerName = transaction.customer_name?.toLowerCase() ?? ''
      return orderNumber.includes(searchTerm) || customerName.includes(searchTerm)
    })
  }, [data, searchTerm])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Transaction History</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="Search order number or customer..."
            className="w-72 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            type="button"
            onClick={runSearch}
            className="px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Search
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 italic">Loading history...</p>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 italic">No completed transactions yet</p>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 italic">No matching transactions</p>
          </div>
        ) : (
          filteredData.map((transaction) => <HistoryCard key={transaction.id} transaction={transaction} />)
        )}
      </div>
    </div>
  )
}
