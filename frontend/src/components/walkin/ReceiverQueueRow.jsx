import { useEffect, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { formatCurrency } from '../../utils/format'
import { timeAgoShort } from '../../utils/time'

export function ReceiverQueueRow({ transaction, onEdit }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const isProcessing = transaction.queue_status === 'processing'
  const itemCount = transaction.items.length

  // Force a re-render every 60s so the relative time stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const cardBg = isProcessing ? 'bg-blue-50' : 'bg-white'
  const accent = isProcessing ? 'border-l-4 border-l-blue-400' : 'border-l-4 border-l-amber-400'

  return (
    <div className={`border border-gray-200 rounded-md px-3 py-3 mb-1 hover:bg-gray-50 ${cardBg} ${accent}`}>
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono font-bold text-sm text-gray-900 truncate">{transaction.order_number}</span>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="font-bold text-primary">{formatCurrency(transaction.total_due)}</span>
          <span className="text-xs text-amber-500">{timeAgoShort(transaction.updated_at)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mt-1">
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-sm text-gray-600 truncate">{customer?.full_name ?? '...'}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            · {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
        </div>
        {isProcessing ? (
          <button
            type="button"
            disabled
            className="px-4 py-1.5 text-sm rounded-md bg-gray-200 text-gray-500 flex-shrink-0"
          >
            Processing...
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary-dark flex-shrink-0"
          >
            Edit Order
          </button>
        )}
      </div>
    </div>
  )
}
