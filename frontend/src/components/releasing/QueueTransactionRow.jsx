import { useEffect, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { timeAgoShort, isParkedStale, formatElapsedDuration } from '../../utils/time'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

const STATUS_PILL = {
  waiting: { label: 'Waiting', className: 'bg-gray-100 text-gray-700' },
  parked: { label: 'Parked', className: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Being Processed', className: 'bg-blue-100 text-blue-800' },
}

const AWAITING_PAYMENT_PILL = { label: 'Awaiting Payment', className: 'bg-purple-100 text-purple-700' }
const PAYMENT_RESOLVED_PILL = { label: 'Payment Resolved', className: 'bg-green-100 text-green-700' }
const PAYMENT_CONFIRMED_PILL = { label: 'Payment Confirmed', className: 'bg-indigo-100 text-indigo-700' }

export function QueueTransactionRow({ transaction, onProcess, onReview, onConfirmOnline, now }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  // Releasing already handed this off to Payment (a child adjustment/refund is
  // sitting in their queue) — this card is read-only until Payment resolves it,
  // no grab/process action makes sense here.
  const isAwaitingPayment = transaction.transaction_status === 'pending_adjustment'
  // Payment has resolved the adjustment/refund child — actionable again, but
  // through the handover-review step instead of the normal grab/process flow.
  const isSettled = transaction.transaction_status === 'settled'
  // Payment confirmed a plain online order's payment — same "one more step"
  // idea as isSettled above, but for the ordinary flow rather than a
  // substandard adjustment/refund resolution (see complete_online).
  const isPendingHandover = transaction.transaction_status === 'pending_handover'
  const isParked = transaction.queue_status === 'parked'
  const isProcessing = transaction.queue_status === 'processing'
  const isStaleParked = isParked && isParkedStale(transaction.parked_at, now)
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const statusPill = isAwaitingPayment
    ? AWAITING_PAYMENT_PILL
    : isPendingHandover
      ? PAYMENT_CONFIRMED_PILL
      : isSettled
        ? PAYMENT_RESOLVED_PILL
        : STATUS_PILL[transaction.queue_status] ?? STATUS_PILL.waiting

  // Force a re-render every 60s so the relative time stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const cardBg = isAwaitingPayment
    ? 'bg-gray-100'
    : isPendingHandover
      ? 'bg-indigo-50'
      : isSettled
        ? 'bg-green-50'
        : isStaleParked
          ? 'bg-red-50'
          : isParked
            ? 'bg-yellow-50'
            : isProcessing
              ? 'bg-blue-50'
              : 'bg-white'
  const accent = isPendingHandover
    ? 'border-l-4 border-l-indigo-500'
    : isSettled
      ? 'border-l-4 border-l-green-500'
      : isStaleParked
        ? 'border-l-4 border-l-red-500'
        : isParked
          ? 'border-l-4 border-l-yellow-400'
          : isProcessing
            ? 'border-l-4 border-l-blue-400'
            : ''

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
          <div className={`text-xs ${isStaleParked ? 'text-red-600' : 'text-amber-500'}`}>
            {isStaleParked
              ? `Parked ${formatElapsedDuration(transaction.parked_at, now)}`
              : `Parked · ${timeAgoShort(transaction.parked_at)}`}
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
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusPill.className}`}
        >
          {statusPill.label}
        </span>
      </div>

      <div className="flex-none flex items-center gap-4">
        {isAwaitingPayment ? null : isPendingHandover ? (
          <button
            type="button"
            onClick={() => onConfirmOnline(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Confirm Handover
          </button>
        ) : isSettled ? (
          <button
            type="button"
            onClick={() => onReview(transaction)}
            className="px-4 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700"
          >
            Review &amp; Confirm
          </button>
        ) : isProcessing ? (
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
            className="px-4 py-1.5 text-sm rounded-md bg-brand-black text-brand-gold border border-brand-gold hover:bg-brand-gold hover:text-brand-black"
          >
            Process
          </button>
        )}
      </div>
    </div>
  )
}
