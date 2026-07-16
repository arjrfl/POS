import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { Badge } from '../ui/Badge'
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
        <Badge status={transaction.transaction_status} />
      </div>

      <div className="flex-none text-right">
        <div className="font-bold text-sm text-primary whitespace-nowrap">{formatCurrency(transaction.total_due)}</div>
        {transaction.payment_methods.length > 0 && (
          <div className="text-xs text-gray-500">{transaction.payment_methods.join(', ')}</div>
        )}
        <div className="text-xs text-gray-400">{new Date(transaction.finished_at).toLocaleString()}</div>
      </div>
    </div>
  )
}

export function TransactionHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'history'],
    queryFn: fetchTransactionHistory,
  })

  return (
    <div className="h-full flex flex-col min-h-0">
      <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Transaction History</span>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 italic">Loading history...</p>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 italic">No completed transactions yet</p>
          </div>
        ) : (
          data.map((transaction) => <HistoryCard key={transaction.id} transaction={transaction} />)
        )}
      </div>
    </div>
  )
}
