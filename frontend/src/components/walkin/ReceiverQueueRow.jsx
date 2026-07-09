import { useEffect, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
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
    <div
      className={`flex items-center justify-between px-4 py-3 border border-gray-200 rounded-md mb-1 hover:bg-gray-50 ${cardBg} ${accent}`}
    >
      <div className="flex-1">
        <div className="font-mono font-bold text-base text-gray-900 truncate">{transaction.order_number}</div>
        <div className="text-sm text-gray-500 truncate">
          {customer?.full_name ?? '...'} · {itemCount} item{itemCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex-none flex items-center gap-6">
        <span className="text-xs text-amber-500 whitespace-nowrap">{timeAgoShort(transaction.updated_at)}</span>
        {isProcessing ? (
          <button type="button" disabled className="px-4 py-1.5 text-sm rounded-md bg-gray-200 text-gray-500">
            Processing...
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary-dark"
          >
            Edit Order
          </button>
        )}
      </div>
    </div>
  )
}
