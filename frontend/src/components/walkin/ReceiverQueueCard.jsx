import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useCustomer } from '../../hooks/useCustomer'
import { formatCurrency } from '../../utils/currency'
import { timeAgo } from '../../utils/time'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

// mode: 'returned' — pending_edit, any receiver may pick it up
//       'own'      — created by the current receiver, read-only reference
export function ReceiverQueueCard({ transaction, mode, onEdit }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const itemCount = transaction.items.length
  const timestamp = mode === 'returned' ? transaction.updated_at : transaction.walkin_at

  return (
    <Card className={mode === 'returned' ? 'bg-yellow-50 border-yellow-300' : ''}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900">{transaction.order_number}</span>
        {mode === 'own' && <Badge status={transaction.transaction_status} />}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-gray-700">{customer?.full_name ?? '...'}</span>
        {typeBadge && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
        <span>
          {itemCount} item{itemCount === 1 ? '' : 's'}
        </span>
        <span className="font-semibold text-gray-900">{formatCurrency(transaction.total_due)}</span>
      </div>

      <div className="mt-1 flex items-center justify-between">
        {mode === 'returned' ? (
          <span className="text-xs font-medium text-orange-700">Returned from Payment</span>
        ) : (
          <span />
        )}
        <span className="text-xs text-gray-500">{timeAgo(timestamp)}</span>
      </div>

      {mode === 'returned' && (
        <Button type="button" className="mt-3 w-full" onClick={() => onEdit(transaction)}>
          Edit Order
        </Button>
      )}
    </Card>
  )
}
