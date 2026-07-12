import { useMemo } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { WeightConfirmForm } from './WeightConfirmForm'
import { SubstandardResolution } from './SubstandardResolution'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

export function ReleaseProcessor({ transaction, onConfirmReady, onConfirmWeights, onResolve, submitting }) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: products } = useProducts()

  const productsById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  // Same dual-display as before restyling: product items get their own read-only
  // row here AND their own weight-input card further down — balance_settlement/
  // credit_usage items (if any, on a mixed original order) are excluded, matching
  // Payment's order-details table which is product-only too.
  const displayItems = useMemo(() => {
    if (!transaction) return []
    return transaction.items
      .filter((item) => item.item_type === 'product')
      .map((item) => {
        const product = productsById.get(item.product_id)
        return {
          id: item.id,
          product_name: product?.product_name ?? `Product #${item.product_id}`,
          brand_name: product?.brand_name ?? null,
          unit_count: item.unit_count,
          quantity_kg: Number(item.quantity_kg),
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
        }
      })
  }, [transaction, productsById])

  if (!transaction) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500 italic">Select a transaction from the queue to process it</p>
      </div>
    )
  }

  const isOnline = transaction.customer_type === 'online'
  const weightConfirmed = transaction.actual_amount != null
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <div className="text-lg font-bold text-gray-900 mb-1">{transaction.order_number}</div>
        <div className="text-xl font-bold text-primary">{customer?.full_name ?? '...'}</div>
        {customer?.address && <div className="text-sm text-gray-500">{customer.address}</div>}
        {typeBadge && (
          <span
            className={`inline-flex items-center px-2.5 py-0.5 mt-1 rounded-full text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        )}
      </div>

      <div className="border-t border-gray-200">
        {displayItems.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">No items on this order.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2 font-medium">QTY</th>
                <th className="py-2 pr-2 font-medium">UNIT</th>
                <th className="py-2 pr-2 font-medium">ARTICLES</th>
                <th className="py-2 pr-2 font-medium">UNIT PRICE</th>
                <th className="py-2 pr-2 font-medium">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-b-0 align-top">
                  <td className="py-2 pr-2 text-gray-700">{item.quantity_kg.toFixed(3)}</td>
                  <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium text-gray-900">{item.product_name}</div>
                    {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                  </td>
                  <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                  <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
        <span className="font-semibold text-gray-900">TOTAL DUE</span>
        <span className="text-2xl font-bold text-primary">{formatCurrency(transaction.total_due)}</span>
      </div>

      <div>
        {isOnline ? (
          <Button type="button" disabled={submitting} onClick={onConfirmReady} className="w-full">
            {submitting ? 'Confirming...' : '✓ Confirm Items Ready'}
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
      </div>
    </Card>
  )
}
