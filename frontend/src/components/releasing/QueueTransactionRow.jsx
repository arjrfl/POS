import { useEffect, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { timeAgoShort } from '../../utils/time'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

const STATUS_PILL = {
  waiting: { label: 'Waiting', className: 'bg-gray-100 text-gray-700' },
  parked: { label: 'Parked', className: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Being Processed', className: 'bg-blue-100 text-blue-800' },
}

const AWAITING_PAYMENT_PILL = { label: 'Awaiting Payment', className: 'bg-purple-100 text-purple-700' }

export function QueueTransactionRow({ transaction, onProcess }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  // Releasing already handed this off to Payment (a child adjustment/refund is
  // sitting in their queue) — this card is read-only until Payment resolves it,
  // no grab/process action makes sense here.
  const isAwaitingPayment = transaction.transaction_status === 'pending_adjustment'
  const isParked = transaction.queue_status === 'parked'
  const isProcessing = transaction.queue_status === 'processing'
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const statusPill = isAwaitingPayment ? AWAITING_PAYMENT_PILL : STATUS_PILL[transaction.queue_status] ?? STATUS_PILL.waiting

  // Force a re-render every 60s so the relative time stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const cardBg = isAwaitingPayment ? 'bg-gray-100' : isParked ? 'bg-yellow-50' : isProcessing ? 'bg-blue-50' : 'bg-white'
  const accent = isParked ? 'border-l-4 border-l-yellow-400' : isProcessing ? 'border-l-4 border-l-blue-400' : ''

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 border border-gray-200 rounded-md mb-1 ${cardBg} ${accent} ${
        isAwaitingPayment ? 'opacity-70' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex-none w-48">
        <div className="font-mono font-bold text-base text-gray-900 truncate">{transaction.order_number}</div>
        <div className="text-sm text-gray-500 truncate">{customer?.full_name ?? '...'}</div>
        {isAwaitingPayment && <div className="text-xs text-gray-500">Awaiting Payment Resolution</div>}
        {isParked && (
          <div className="text-xs text-amber-500">Parked · {timeAgoShort(transaction.parked_at)}</div>
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
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusPill.className}`}
        >
          {statusPill.label}
        </span>
      </div>

      <div className="flex-none flex items-center gap-4">
        {isAwaitingPayment ? null : isProcessing ? (
          <button type="button" disabled className="px-4 py-1.5 text-sm rounded-md bg-gray-200 text-gray-500">
            Processing...
          </button>
        ) : isParked ? (
          <button
            type="button"
            onClick={() => onProcess(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600"
          >
            Unpark
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onProcess(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary-dark"
          >
            Process
          </button>
        )}
      </div>
    </div>
  )
}
