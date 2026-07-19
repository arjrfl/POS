import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

const EPS = 0.005

export function ItemEditModal({ item, initialValues, onConfirm, onCancel }) {
  // First-time edit defaults Actual fields to match the originals (never
  // product.unit_weight_kg, the generic catalog weight, which can legitimately
  // differ) — this keeps initial variance at 0 ("✓ Exact weight"), same intent
  // as Receiver's own QTY default. Re-editing an already-confirmed item instead
  // starts from whatever was entered last time (initialValues, held in
  // ReleaseProcessor's local state).
  const [actualWeight, setActualWeight] = useState(
    String(initialValues ? initialValues.actualWeight ?? '' : item.estimated_weight_kg ?? ''),
  )
  const [actualUnitCount, setActualUnitCount] = useState(
    String(initialValues ? initialValues.actualUnitCount ?? '' : item.unit_count ?? ''),
  )
  const [actualQty, setActualQty] = useState(
    String(initialValues ? initialValues.actualQty ?? '' : item.quantity_kg ?? ''),
  )

  const quantityKg = Number(item.quantity_kg)
  const estimatedAmount = quantityKg * item.unit_price

  // "Last touched wins" — whichever of Actual Weight / Actual Unit Count the user
  // edited most recently recomputes Actual QTY as weight * count. If the other
  // field is still empty/0 (not yet entered), Actual QTY falls back to the raw
  // new value instead of multiplying to zero. Actual QTY itself is always
  // freely editable and never re-derived once the user types into it directly
  // — same as Receiver (see ProductSelector.jsx).
  const multiplyKg = (weight, count) => Math.round(weight * count * 1000) / 1000

  const handleWeightChange = (value) => {
    setActualWeight(value)
    const count = actualUnitCount === '' ? 0 : Number(actualUnitCount)
    setActualQty(value === '' || !count ? value : String(multiplyKg(Number(value), count)))
  }

  const handleUnitCountChange = (value) => {
    setActualUnitCount(value)
    const weight = actualWeight === '' ? 0 : Number(actualWeight)
    setActualQty(value === '' || !weight ? value : String(multiplyKg(weight, Number(value))))
  }

  const handleQtyChange = (value) => {
    setActualQty(value)
  }

  const parsedWeight = actualWeight === '' ? null : Number(actualWeight)
  const parsedUnitCount = actualUnitCount === '' ? null : Number(actualUnitCount)
  const parsedQty = actualQty === '' ? null : Number(actualQty)

  let validationError = null
  if (!parsedUnitCount || parsedUnitCount <= 0) {
    validationError = 'Actual unit count is required'
  } else if (!parsedQty || parsedQty <= 0) {
    validationError = 'Actual QTY is required'
  } else if (actualWeight !== '' && (!Number.isFinite(parsedWeight) || parsedWeight < 0)) {
    validationError = 'Actual weight must be a valid number'
  }

  const isValid = validationError === null
  const actualAmount = isValid ? parsedQty * item.unit_price : 0
  // Variance is measured against quantity_kg (QTY) — the new baseline — not
  // estimated_weight_kg, so it reflects what actually drives actual_subtotal.
  const diff = isValid ? (parsedQty - quantityKg) * item.unit_price : 0

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
    onConfirm(
      item.id,
      { actualWeight: parsedWeight, actualUnitCount: parsedUnitCount, actualQty: parsedQty },
      variance.status,
    )
  }

  return (
    <Modal open onClose={onCancel} title={`Confirm Item — ${item.product_name}`}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="font-semibold text-gray-900">{item.product_name}</div>
          {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
        </div>

        <div className="border-t border-gray-200 pt-3 flex justify-between text-sm text-gray-700">
          <span>Unit Price</span>
          <span>{formatCurrency(item.unit_price)}</span>
        </div>

        <div className="border-t border-gray-200 pt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <span className="text-sm font-medium text-gray-700">Estimated Weight (kg)</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">
                {item.estimated_weight_kg ?? '—'}
              </div>
            </div>
            <Input
              id="actual-weight"
              label="Actual Weight (kg)"
              type="number"
              step="0.001"
              min="0"
              value={actualWeight}
              onChange={(e) => handleWeightChange(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <span className="text-sm font-medium text-gray-700">Unit Count</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{item.unit_count}</div>
            </div>
            <Input
              id="actual-unit-count"
              label="Actual Unit Count"
              type="number"
              step="1"
              min="0"
              value={actualUnitCount}
              onChange={(e) => handleUnitCountChange(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <span className="text-sm font-medium text-gray-700">QTY (kg)</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{quantityKg.toFixed(3)}</div>
            </div>
            <Input
              id="actual-qty"
              label="Actual QTY (kg)"
              type="number"
              step="0.001"
              min="0"
              value={actualQty}
              onChange={(e) => handleQtyChange(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-3 flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Estimated Amount</span>
            <span className="text-gray-900">{formatCurrency(estimatedAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Actual Amount</span>
            <span className="font-semibold text-gray-900">{formatCurrency(actualAmount)}</span>
          </div>

          {variance ? (
            <p className={`text-sm font-semibold ${variance.className}`}>{variance.label}</p>
          ) : (
            validationError && <p className="text-sm font-semibold text-red-600">{validationError}</p>
          )}
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
