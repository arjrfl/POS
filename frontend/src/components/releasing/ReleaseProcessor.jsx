import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { WeightConfirmForm } from './WeightConfirmForm'
import { SubstandardResolution } from './SubstandardResolution'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

export function ReleaseProcessor({ transaction, onConfirmReady, onConfirmWeights, onResolve, submitting }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const { data: products } = useProducts()

  const isOnline = transaction.customer_type === 'online'
  const weightConfirmed = transaction.actual_amount != null

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{transaction.order_number}</h2>
          <Badge status={transaction.customer_type}>{isOnline ? 'Online' : 'Walk-In'}</Badge>
        </div>
        <p className="text-sm text-gray-500">{customer?.full_name ?? '...'}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {transaction.items.map((item) => {
          if (item.item_type === 'product') {
            const product = products?.find((p) => p.id === item.product_id)
            return (
              <li key={item.id} className="flex justify-between text-sm text-gray-700">
                <span>
                  {product?.product_name ?? `Product #${item.product_id}`} ({item.estimated_weight_kg}kg)
                </span>
                <span>{formatCurrency(item.subtotal)}</span>
              </li>
            )
          }
          if (item.item_type === 'balance_settlement') {
            return (
              <li key={item.id} className="flex justify-between text-sm text-red-600">
                <span>Balance Settlement</span>
                <span>{formatCurrency(item.subtotal)}</span>
              </li>
            )
          }
          return (
            <li key={item.id} className="flex justify-between text-sm text-green-700">
              <span>Credit Applied</span>
              <span>{formatCurrency(item.subtotal)}</span>
            </li>
          )
        })}
      </ul>

      {isOnline ? (
        <Button type="button" disabled={submitting} onClick={onConfirmReady} className="w-full">
          {submitting ? 'Confirming...' : 'Confirm Items Ready'}
        </Button>
      ) : weightConfirmed ? (
        <SubstandardResolution
          transaction={transaction}
          customer={customer}
          onResolve={onResolve}
          submitting={submitting}
        />
      ) : (
        <WeightConfirmForm transaction={transaction} onConfirm={onConfirmWeights} submitting={submitting} />
      )}
    </Card>
  )
}
