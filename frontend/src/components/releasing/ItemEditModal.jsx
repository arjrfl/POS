import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

const EPS = 0.005

export function ItemEditModal({ item, initialWeight, onConfirm, onCancel }) {
  // First-time edit defaults to estimated_weight_kg (what was actually ordered
  // for this line item — never product.unit_weight_kg, the generic catalog
  // weight, which can legitimately differ). Re-editing an already-confirmed
  // item instead starts from whatever was entered last time.
  const [actualWeight, setActualWeight] = useState(
    String(initialWeight ?? item.estimated_weight_kg ?? ''),
  )

  const estimatedWeight = Number(item.estimated_weight_kg)
  const estimatedAmount = estimatedWeight * item.unit_price

  const parsedWeight = Number(actualWeight)
  const isValid = actualWeight !== '' && Number.isFinite(parsedWeight) && parsedWeight >= 0
  const actualAmount = isValid ? parsedWeight * item.unit_price : 0
  // Variance is measured against estimated_weight_kg — the weight this modal
  // itself defaults to — so an untouched input always reads as exact, never a
  // false heavier/lighter from quantity_kg happening to differ from it.
  const diff = isValid ? (parsedWeight - estimatedWeight) * item.unit_price : 0

  let variance = null
  if (isValid) {
    if (Math.abs(diff) <= EPS) {
      variance = { label: '✓ Exact weight', className: 'text-green-700', status: 'exact' }
    } else if (diff > 0) {
      variance = { label: `+${formatCurrency(diff)} — Item is heavier`, className: 'text-amber-600', status: 'heavier' }
    } else {
      variance = { label: `-${formatCurrency(Math.abs(diff))} — Item is lighter`, className: 'text-blue-600', status: 'lighter' }
    }
  }

  const handleConfirm = () => {
    if (!isValid || !variance) return
    onConfirm(item.id, parsedWeight, variance.status)
  }

  return (
    <Modal open onClose={onCancel} title={`Confirm Item — ${item.product_name}`}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="font-semibold text-gray-900">{item.product_name}</div>
          {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
        </div>

        <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>Estimated Weight</span>
            <span>{item.estimated_weight_kg} kg</span>
          </div>
          <div className="flex justify-between text-gray-700">
            <span>Unit Price</span>
            <span>{formatCurrency(item.unit_price)}</span>
          </div>
          <div className="flex justify-between text-gray-700">
            <span>Estimated Amount</span>
            <span>{formatCurrency(estimatedAmount)}</span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
          <Input
            id="actual-weight"
            label="Actual Weight (kg)"
            type="number"
            step="0.001"
            min="0"
            placeholder={String(item.estimated_weight_kg)}
            value={actualWeight}
            onChange={(e) => setActualWeight(e.target.value)}
            className="w-32"
            autoFocus
          />

          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Actual Amount</span>
            <span className="font-semibold text-gray-900">{formatCurrency(actualAmount)}</span>
          </div>

          {variance && <p className={`text-sm font-semibold ${variance.className}`}>{variance.label}</p>}
        </div>

        <div className="flex gap-2 mt-2">
          <Button type="button" className="flex-1" disabled={!isValid} onClick={handleConfirm}>
            Confirm Item
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
