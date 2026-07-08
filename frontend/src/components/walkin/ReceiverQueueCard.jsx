import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useCustomer } from '../../hooks/useCustomer'
import { formatCurrency } from '../../utils/format'
import { timeAgo } from '../../utils/time'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

export function ReceiverQueueCard({ transaction, onEdit }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const itemCount = transaction.items.length

  return (
    <Card className="bg-yellow-50 border-yellow-300">
      <span className="font-semibold text-gray-900">{transaction.order_number}</span>

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
        <span className="text-xs font-medium text-orange-700">Returned from Payment</span>
        <span className="text-xs text-gray-500">{timeAgo(transaction.updated_at)}</span>
      </div>

      <Button type="button" className="mt-3 w-full" onClick={() => onEdit(transaction)}>
        Edit Order
      </Button>
    </Card>
  )
}
