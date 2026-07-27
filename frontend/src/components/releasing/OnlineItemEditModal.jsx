import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'
import { patch } from '../../services/api'

// Releasing's plain pre-payment edit of a single online-order item — no
// add/delete/restore, no actual-vs-estimated variance coloring (there's no
// "actual" yet at this phase). Scoped to exactly one item per open, same
// pattern as ItemEditModal.jsx (the substandard-phase per-item modal), just
// without the Actual-weight/variance fields that only apply once weights are
// being confirmed.
export function OnlineItemEditModal({ transactionId, item, onSaved, onCancel, showToast }) {
  const [estimatedWeight, setEstimatedWeight] = useState(
    item.estimated_weight_kg != null ? String(item.estimated_weight_kg) : '',
  )
  const [unitCount, setUnitCount] = useState(item.unit_count != null ? String(item.unit_count) : '')
  const [qty, setQty] = useState(String(item.quantity_kg))
  const [saving, setSaving] = useState(false)

  // "Last touched wins" — same calculation as ItemEditModal.jsx / ProductSelector.jsx.
  const multiplyKg = (weight, count) => Math.round(weight * count * 1000) / 1000

  const handleWeightChange = (value) => {
    setEstimatedWeight(value)
    const count = unitCount === '' ? 0 : Number(unitCount)
    setQty(value === '' || !count ? value : String(multiplyKg(Number(value), count)))
  }

  const handleUnitCountChange = (value) => {
    setUnitCount(value)
    const weight = estimatedWeight === '' ? 0 : Number(estimatedWeight)
    setQty(value === '' || !weight ? value : String(multiplyKg(weight, Number(value))))
  }

  const parsedQty = qty === '' ? null : Number(qty)
  const isValid = parsedQty != null && Number.isFinite(parsedQty) && parsedQty > 0
  const currentAmount = Number(item.quantity_kg) * item.unit_price
  const newAmount = isValid ? parsedQty * item.unit_price : 0

  const handleSave = async () => {
    if (!isValid || saving) return
    setSaving(true)
    try {
      const updated = await patch(`/transactions/${transactionId}/releasing-items`, {
        items: [
          {
            item_id: item.id,
            quantity_kg: qty,
            unit_count: unitCount === '' ? null : Number(unitCount),
            estimated_weight_kg: estimatedWeight === '' ? null : estimatedWeight,
          },
        ],
      })
      onSaved(updated)
      showToast('Item updated', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onCancel} title={`Edit Item — ${item.product_name}`}>
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
              <span className="text-sm font-medium text-gray-700">Est. Weight (kg)</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">
                {item.estimated_weight_kg ?? '—'}
              </div>
            </div>
            <Input
              id="online-item-est-weight"
              label="New Weight (kg)"
              type="number"
              step="0.001"
              min="0"
              value={estimatedWeight}
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
              id="online-item-unit-count"
              label="New Unit Count"
              type="number"
              step="1"
              min="0"
              value={unitCount}
              onChange={(e) => handleUnitCountChange(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <span className="text-sm font-medium text-gray-700">QTY (kg)</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">
                {Number(item.quantity_kg).toFixed(3)}
              </div>
            </div>
            <Input
              id="online-item-qty"
              label="New QTY (kg)"
              type="number"
              step="0.001"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-3 flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Current Amount</span>
            <span className="text-gray-900">{formatCurrency(currentAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">New Amount</span>
            <span className="font-semibold text-gray-900">{formatCurrency(newAmount)}</span>
          </div>
          {!isValid && <p className="text-sm font-semibold text-red-600">QTY must be greater than zero</p>}
        </div>

        <div className="flex gap-2 mt-2">
          <Button type="button" className="flex-1" disabled={!isValid || saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button type="button" variant="outline" className="flex-1" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
