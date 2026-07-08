import { useEffect, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { useAdminQueue } from '../../hooks/useQueue'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCurrency } from '../../utils/currency'
import { timeAgo } from '../../utils/time'

const PARKED_ALERT_THRESHOLD_MS = 30 * 60 * 1000

function QueueRow({ transaction }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const isParked = transaction.queue_status === 'parked'
  const isStale = isParked && transaction.parked_at && Date.now() - new Date(transaction.parked_at).getTime() > PARKED_ALERT_THRESHOLD_MS

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${
        isStale
          ? 'bg-red-50 border-red-300'
          : isParked
            ? 'bg-yellow-50 border-yellow-300'
            : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isStale && (
            <span className="text-red-600" title="Parked over 30 minutes" aria-label="Parked over 30 minutes">
              ⚠
            </span>
          )}
          <span className="font-medium text-gray-900 truncate">{transaction.order_number}</span>
          <Badge status={transaction.queue_status} />
        </div>
        <div className="text-sm text-gray-500 truncate">{customer?.full_name ?? '...'}</div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-sm font-medium text-gray-900">{formatCurrency(transaction.total_due)}</div>
        {isParked ? (
          <div className={`text-xs ${isStale ? 'text-red-700 font-semibold' : 'text-yellow-800'}`}>
            Parked {timeAgo(transaction.parked_at)}
          </div>
        ) : transaction.queue_status === 'processing' ? (
          <div className="text-xs text-gray-500">
            By user #{transaction.processing_by_user_id} · {timeAgo(transaction.processing_started_at)}
          </div>
        ) : (
          <div className="text-xs text-gray-400">Waiting</div>
        )}
      </div>
    </div>
  )
}

function QueueColumn({ title, status }) {
  const { data, isLoading } = useAdminQueue(status)

  const items = data?.items ?? []
  const parkedOverdue = items.filter(
    (t) => t.queue_status === 'parked' && t.parked_at && Date.now() - new Date(t.parked_at).getTime() > PARKED_ALERT_THRESHOLD_MS,
  ).length

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-2">
          {parkedOverdue > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
              ⚠ {parkedOverdue} overdue
            </span>
          )}
          <span className="text-xs text-gray-500">{items.length} total</span>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {!isLoading && items.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">Queue is empty.</p>}
      {!isLoading && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((transaction) => (
            <QueueRow key={transaction.id} transaction={transaction} />
          ))}
        </div>
      )}
    </Card>
  )
}

export function QueueMonitorSection() {
  // Re-render periodically so "parked Xm ago" / the 30-min overdue flag stay live
  // even when no WebSocket event happens to fire in the meantime.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <QueueColumn title="Payment Queue" status="pending_payment" />
      <QueueColumn title="Releasing Queue" status="pending_settlement" />
    </div>
  )
}
