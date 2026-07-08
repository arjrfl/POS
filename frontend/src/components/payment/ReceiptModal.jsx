import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { usePaymentMethods } from '../../hooks/usePaymentMethods'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

export function ReceiptModal({ transaction, onClose }) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: products } = useProducts()
  const { data: methods } = usePaymentMethods()

  if (!transaction) return null

  const methodName = (id) => methods?.find((m) => m.id === id)?.payment_method_name ?? `#${id}`

  return (
    <Modal open={!!transaction} onClose={onClose} title="Payment Confirmed">
      <div className="print-receipt flex flex-col gap-3">
        <div>
          <div className="font-semibold text-gray-900">{transaction.order_number}</div>
          <div className="text-sm text-gray-500">{customer?.full_name}</div>
        </div>

        <ul className="flex flex-col gap-1 text-sm">
          {transaction.items.map((item) => {
            if (item.item_type === 'product') {
              const product = products?.find((p) => p.id === item.product_id)
              return (
                <li key={item.id} className="flex justify-between">
                  <span>
                    {product?.product_name ?? `Product #${item.product_id}`} ({item.estimated_weight_kg}kg)
                  </span>
                  <span>{formatCurrency(item.subtotal)}</span>
                </li>
              )
            }
            return (
              <li key={item.id} className="flex justify-between">
                <span>{item.item_type === 'balance_settlement' ? 'Balance Settlement' : 'Credit Applied'}</span>
                <span>{formatCurrency(item.subtotal)}</span>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-900">
          <span>Total</span>
          <span>{formatCurrency(transaction.total_due)}</span>
        </div>

        <div className="text-sm text-gray-700">
          {transaction.payment_details.map((detail) => (
            <div key={detail.id} className="flex justify-between">
              <span className="capitalize">
                {methodName(detail.payment_method_id)}
                {detail.ref_number ? ` (${detail.ref_number})` : ''}
              </span>
              <span>{formatCurrency(detail.amount)}</span>
            </div>
          ))}
          {Number(transaction.change_given) > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Change given</span>
              <span>{formatCurrency(transaction.change_given)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => window.print()}>
          Print Receipt
        </Button>
        <Button type="button" className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
