import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { timeAgo } from '../../utils/time'

function itemsSummary(items, products) {
  const productItems = items.filter((item) => item.item_type === 'product')
  if (productItems.length === 0) return 'No product items'

  return productItems
    .map((item) => {
      const product = products?.find((p) => p.id === item.product_id)
      const name = product?.product_name ?? `Product #${item.product_id}`
      return item.unit_count ? `${name} ×${item.unit_count}` : name
    })
    .join(', ')
}

export function QueueTransactionCard({ transaction, onProcess }) {
  const { user } = useAuth()
  const { data: customer } = useCustomer(transaction.customer_id)
  const { data: products } = useProducts()
  const isParked = transaction.queue_status === 'parked'

  // Force a re-render periodically so the relative "time waiting" text stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const parkedByLabel =
    transaction.parked_by_user_id === user?.id ? 'Parked by you' : `Parked by user #${transaction.parked_by_user_id}`

  return (
    <Card className={isParked ? 'bg-yellow-50 border-yellow-300' : ''}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900">{transaction.order_number}</span>
        {isParked ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900">
            PARKED
          </span>
        ) : (
          <Badge status={transaction.queue_status} />
        )}
      </div>

      <div className="mt-1 text-sm text-gray-700">{customer?.full_name ?? '...'}</div>

      <div className="mt-2 text-sm text-gray-600">{itemsSummary(transaction.items, products)}</div>

      <div className="mt-2 flex items-center justify-end">
        <span className="text-xs text-gray-500">{timeAgo(transaction.updated_at)}</span>
      </div>

      {isParked && <div className="mt-1 text-xs text-yellow-800">{parkedByLabel}</div>}

      <Button className="mt-3 w-full" onClick={() => onProcess(transaction)}>
        Process
      </Button>
    </Card>
  )
}
