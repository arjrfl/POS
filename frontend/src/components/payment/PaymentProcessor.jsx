import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { PaymentMethodForm } from './PaymentMethodForm'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

export function PaymentProcessor({
  transaction,
  paymentState,
  onPaymentFormChange,
  onConfirmPayment,
  onPark,
  onRelease,
  submitting,
}) {
  const { data: customer } = useCustomer(transaction.customer_id)
  const { data: products } = useProducts()

  const handlePark = () => {
    if (window.confirm('Park this transaction? Customer will need to return.')) {
      onPark()
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{transaction.order_number}</h2>
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

      <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
        <span className="font-semibold text-gray-900">TOTAL DUE</span>
        <span className="text-2xl font-bold text-primary">{formatCurrency(transaction.total_due)}</span>
      </div>

      <PaymentMethodForm totalDue={Number(transaction.total_due)} onChange={onPaymentFormChange} />

      <div className="flex flex-col gap-2 mt-2">
        <Button type="button" disabled={submitting || !paymentState.isValid} onClick={onConfirmPayment} className="w-full">
          {submitting ? 'Processing...' : 'Confirm Payment'}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={handlePark} disabled={submitting}>
            Park
          </Button>
          <Button type="button" variant="danger" className="flex-1" onClick={onRelease} disabled={submitting}>
            Cancel / Release
          </Button>
        </div>
      </div>
    </Card>
  )
}
