import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/useCustomer'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'
import { timeAgo } from '../../utils/time'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

export function QueueTransactionCard({ transaction, onProcess }) {
  const { user } = useAuth()
  const { data: customer } = useCustomer(transaction.customer_id)
  const isParked = transaction.queue_status === 'parked'
  const isProcessing = transaction.queue_status === 'processing'
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const itemCount = transaction.items.length

  // Force a re-render periodically so the relative "time waiting" text stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const parkedByLabel =
    transaction.parked_by_user_id === user?.id ? 'you' : `user #${transaction.parked_by_user_id}`

  return (
    <Card className={isParked ? 'border-l-4 border-l-yellow-400 bg-yellow-50' : ''}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-900">{transaction.order_number}</span>
        {typeBadge && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        )}
      </div>

      <div className="mt-1 text-sm text-gray-700">{customer?.full_name ?? '...'}</div>

      <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
        <span>
          {itemCount} item{itemCount === 1 ? '' : 's'}
        </span>
        <span className="text-lg font-bold text-primary">{formatCurrency(transaction.total_due)}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {isParked ? (
          <span className="text-xs font-medium text-yellow-800">
            Parked {timeAgo(transaction.parked_at)} by {parkedByLabel}
          </span>
        ) : isProcessing ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Being processed
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            Waiting
          </span>
        )}
        <span className="text-xs text-gray-500">{timeAgo(transaction.updated_at)}</span>
      </div>

      <Button className="mt-3 w-full" disabled={isProcessing} onClick={() => onProcess(transaction)}>
        Process
      </Button>
    </Card>
  )
}
