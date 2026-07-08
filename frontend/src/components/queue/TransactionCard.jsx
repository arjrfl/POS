import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

export function TransactionCard({ transaction, onClick }) {
  const {
    id,
    customer_type: customerType,
    transaction_status: transactionStatus,
    queue_status: queueStatus,
    balance_due: balanceDue,
  } = transaction

  return (
    <Card
      onClick={onClick}
      className={onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900">Transaction #{id}</span>
        <Badge status={transactionStatus} />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
        <span className="capitalize">{customerType?.replace('_', ' ')}</span>
        {queueStatus && <Badge status={queueStatus} />}
      </div>
      {balanceDue != null && (
        <div className="mt-2 text-sm font-medium text-gray-800">
          Balance due: ₱{Number(balanceDue).toFixed(2)}
        </div>
      )}
    </Card>
  )
}
