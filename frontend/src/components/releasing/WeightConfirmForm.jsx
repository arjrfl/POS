import { useState } from 'react'
import { useProducts } from '../../hooks/useProducts'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

export function WeightConfirmForm({ transaction, onConfirm, submitting }) {
  const { data: products } = useProducts()
  const productItems = transaction.items.filter((item) => item.item_type === 'product')

  const [weights, setWeights] = useState(() =>
    Object.fromEntries(productItems.map((item) => [item.id, item.estimated_weight_kg]))
  )

  const handleWeightChange = (itemId, value) => {
    setWeights((prev) => ({ ...prev, [itemId]: value }))
  }

  const subtotalFor = (item) => {
    const weight = Number(weights[item.id])
    const price = Number(item.unit_price)
    return Number.isFinite(weight) ? weight * price : 0
  }

  const actualTotal = productItems.reduce((sum, item) => sum + subtotalFor(item), 0)
  const estimatedTotal = Number(transaction.estimated_amount)

  const allWeightsValid = productItems.every((item) => {
    const weight = Number(weights[item.id])
    return weights[item.id] !== '' && Number.isFinite(weight) && weight >= 0
  })

  const handleSubmit = () => {
    if (!allWeightsValid) return
    onConfirm(
      productItems.map((item) => ({
        transaction_item_id: item.id,
        actual_weight_kg: String(weights[item.id]),
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-gray-900">Confirm Actual Weight</h3>

      <div className="flex flex-col gap-3">
        {productItems.map((item) => {
          const product = products?.find((p) => p.id === item.product_id)
          return (
            <div key={item.id} className="border border-gray-200 rounded-md p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900">{product?.product_name ?? `Product #${item.product_id}`}</span>
                <span className="text-gray-500">{formatCurrency(item.unit_price)}/kg</span>
              </div>
              <div className="flex items-end gap-3">
                <div className="text-sm text-gray-500">
                  Estimated
                  <div className="font-medium text-gray-700">{item.estimated_weight_kg}kg</div>
                </div>
                <Input
                  id={`actual-weight-${item.id}`}
                  label="Actual weight (kg)"
                  type="number"
                  step="0.001"
                  min="0"
                  value={weights[item.id] ?? ''}
                  onChange={(e) => handleWeightChange(item.id, e.target.value)}
                  className="w-28"
                />
                <div className="ml-auto text-sm font-medium text-gray-900">{formatCurrency(subtotalFor(item))}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-sm">
        <div className="flex justify-between text-gray-500">
          <span>Estimated total</span>
          <span>{formatCurrency(estimatedTotal)}</span>
        </div>
        <div className="flex justify-between font-semibold text-gray-900">
          <span>Actual total</span>
          <span>{formatCurrency(actualTotal)}</span>
        </div>
      </div>

      <Button type="button" disabled={submitting || !allWeightsValid} onClick={handleSubmit} className="w-full">
        {submitting ? 'Confirming...' : 'Confirm Weights'}
      </Button>
    </div>
  )
}
