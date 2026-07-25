import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { formatCurrency } from '../../utils/format'

// Local to this table only — ArticleRows' own ARTICLE_ROW_COLUMN_WIDTHS is a
// 5-column layout shared by several other consumers, and doesn't have an
// ACTION column, so it isn't reused here.
const COLUMN_WIDTHS = ['w-[12%]', 'w-[14%]', 'w-[24%]', 'w-[18%]', 'w-[18%]', 'w-[14%]']

// "Last touched wins" — whichever of Estimated Weight / Unit Count the user
// edited most recently recomputes QTY as weight * count. If the other field
// is still empty/0 (not yet entered), QTY falls back to the raw new value
// instead of multiplying to zero. QTY itself is always freely editable and
// never re-derived once the user types into it directly — same calculation
// as ProductSelector.jsx / ItemEditModal.jsx.
const multiplyKg = (weight, count) => Math.round(weight * count * 1000) / 1000

// `items` is the same product-joined display list TransactionDetailPanel
// already computes for its own article table (displayItems) — reused as-is
// here rather than re-deriving it (which would mean a second useProducts()
// call and a redundant /api/products refetch on every modal open).
//
// Edits here are local-only: `localItems` seeds from `items` once (the modal
// is remounted on every open, so it always starts from the real transaction
// data) and Apply/Cancel only ever touch that local copy — nothing here
// calls the API or reaches back into the transaction behind the modal.
export function EditItemsModal({ transaction, items, onClose }) {
  // Snapshot of the values as they were when the modal opened — never
  // mutated afterward. "Modified" and Revert both compare `localItems`
  // against this instead of against `items` (same values at open time, but
  // this makes the comparison's intent explicit and immune to `items`
  // changing identity if the parent ever re-renders while the modal is open).
  const [originalItemsSnapshot] = useState(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          {
            estimated_weight_kg: item.estimated_weight_kg,
            unit_count: item.unit_count,
            quantity_kg: item.quantity_kg,
          },
        ]),
      ),
  )
  const [localItems, setLocalItems] = useState(items)
  const [editingItemId, setEditingItemId] = useState(null)
  const [editWeight, setEditWeight] = useState('')
  const [editUnitCount, setEditUnitCount] = useState('')
  const [editQty, setEditQty] = useState('')
  const [confirmingRevert, setConfirmingRevert] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const editingItem = localItems.find((item) => item.id === editingItemId) ?? null

  const isItemModified = (item) => {
    const original = originalItemsSnapshot.get(item.id)
    if (!original) return false
    return (
      item.estimated_weight_kg !== original.estimated_weight_kg ||
      item.unit_count !== original.unit_count ||
      item.quantity_kg !== original.quantity_kg
    )
  }

  const startEditing = (item) => {
    setEditingItemId(item.id)
    setEditWeight(item.estimated_weight_kg != null ? String(item.estimated_weight_kg) : '')
    setEditUnitCount(item.unit_count != null ? String(item.unit_count) : '')
    setEditQty(item.quantity_kg != null ? String(item.quantity_kg) : '')
    setConfirmingRevert(false)
    setConfirmingDelete(false)
  }

  const stopEditing = () => {
    setEditingItemId(null)
    setConfirmingRevert(false)
    setConfirmingDelete(false)
  }

  const handleWeightChange = (value) => {
    setEditWeight(value)
    const count = editUnitCount === '' ? 0 : Number(editUnitCount)
    setEditQty(value === '' || !count ? value : String(multiplyKg(Number(value), count)))
  }

  const handleUnitCountChange = (value) => {
    setEditUnitCount(value)
    const weight = editWeight === '' ? 0 : Number(editWeight)
    setEditQty(value === '' || !weight ? value : String(multiplyKg(weight, Number(value))))
  }

  const handleQtyChange = (value) => setEditQty(value)

  const handleApply = () => {
    if (!editingItem) return
    const parsedQty = editQty === '' ? 0 : Number(editQty)
    setLocalItems((prev) =>
      prev.map((item) =>
        item.id !== editingItemId
          ? item
          : {
              ...item,
              estimated_weight_kg: editWeight === '' ? null : Number(editWeight),
              unit_count: editUnitCount === '' ? 0 : Number(editUnitCount),
              quantity_kg: parsedQty,
              subtotal: parsedQty * item.unit_price,
            },
      ),
    )
    stopEditing()
  }

  const handleRevert = () => {
    if (!editingItem) return
    const original = originalItemsSnapshot.get(editingItem.id)
    if (!original) return
    setLocalItems((prev) =>
      prev.map((item) =>
        item.id !== editingItemId
          ? item
          : {
              ...item,
              estimated_weight_kg: original.estimated_weight_kg,
              unit_count: original.unit_count,
              quantity_kg: original.quantity_kg,
              subtotal: original.quantity_kg * item.unit_price,
            },
      ),
    )
    // Panel stays open on this item, showing the just-reverted values —
    // unlike Apply/Cancel, Revert doesn't close back to the placeholder.
    setEditWeight(original.estimated_weight_kg != null ? String(original.estimated_weight_kg) : '')
    setEditUnitCount(original.unit_count != null ? String(original.unit_count) : '')
    setEditQty(original.quantity_kg != null ? String(original.quantity_kg) : '')
    setConfirmingRevert(false)
  }

  // A transaction can't end up with zero product items, so deleting the
  // last remaining row is blocked (see canDeleteEditingItem below) — this
  // never fires with a single-item list.
  const handleDeleteItem = () => {
    if (!editingItem) return
    setLocalItems((prev) => prev.filter((item) => item.id !== editingItemId))
    setEditingItemId(null)
    setConfirmingDelete(false)
  }

  const canDeleteEditingItem = localItems.length > 1

  const editAmount = editingItem ? (editQty === '' ? 0 : Number(editQty)) * editingItem.unit_price : 0

  return (
    <Modal open onClose={onClose} title={`Edit Items — ${transaction.order_number}`} size="lg">
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr] gap-4">
          <div className="h-full min-h-0 flex flex-col border border-gray-200 rounded-md overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto pt-0 px-3 pb-3">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[0]}`}>QTY</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[1]}`}>UNIT</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[2]}`}>ARTICLES</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[3]}`}>UNIT PRICE</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[4]}`}>AMOUNT</th>
                    <th className={`py-2 pr-2 font-medium text-center ${COLUMN_WIDTHS[5]}`}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {localItems.map((item) => {
                    // "Currently editing" takes visual precedence over the
                    // persistent "modified" highlight when both apply to the
                    // same row.
                    const isEditing = item.id === editingItemId
                    const rowHighlight = isEditing
                      ? 'bg-blue-50'
                      : isItemModified(item)
                        ? 'bg-amber-50 border-l-4 border-l-amber-400'
                        : ''
                    return (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-100 last:border-b-0 align-top ${rowHighlight}`}
                    >
                      <td className="py-2 pr-2 text-gray-700">{item.quantity_kg.toFixed(3)}</td>
                      <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-900">{item.product_name}</div>
                        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                      </td>
                      <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                      <td className="py-2 pr-2 text-center">
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                          className="inline-flex text-gray-500 hover:text-gray-700"
                          aria-label={`Edit ${item.product_name}`}
                        >
                          <Pencil size={16} />
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="h-full min-h-0 border border-gray-200 rounded-md overflow-y-auto p-4">
            {!editingItem ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-gray-400 text-center">Select an item's edit icon to modify it</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="font-medium text-gray-900">{editingItem.product_name}</div>
                  {editingItem.brand_name && (
                    <div className="text-xs text-gray-500">{editingItem.brand_name}</div>
                  )}
                </div>

                <Input
                  id="edit-item-weight"
                  label="Estimated Weight (kg)"
                  type="number"
                  step="0.001"
                  placeholder="0.000"
                  value={editWeight}
                  onChange={(e) => handleWeightChange(e.target.value)}
                />

                <Input
                  id="edit-item-unit-count"
                  label="Unit Count"
                  type="number"
                  step="1"
                  placeholder="0"
                  value={editUnitCount}
                  onChange={(e) => handleUnitCountChange(e.target.value)}
                />

                <Input
                  id="edit-item-qty"
                  label="QTY (kg)"
                  type="number"
                  step="0.001"
                  placeholder="0.000"
                  value={editQty}
                  onChange={(e) => handleQtyChange(e.target.value)}
                />

                <div>
                  <span className="text-sm font-medium text-gray-700">Unit Price</span>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">
                    {formatCurrency(editingItem.unit_price)}
                  </div>
                </div>

                <div>
                  <span className="text-sm font-medium text-gray-700">Amount</span>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900 font-semibold">
                    {formatCurrency(editAmount)}
                  </div>
                </div>

                {confirmingRevert ? (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-800 mb-2">Revert changes for this item?</p>
                    <div className="flex gap-2">
                      <Button type="button" variant="danger" className="flex-1" onClick={handleRevert}>
                        Yes, Revert
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setConfirmingRevert(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : confirmingDelete ? (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-800 mb-2">
                      Remove {editingItem.product_name} from this order?
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="danger" className="flex-1" onClick={handleDeleteItem}>
                        Yes, Delete
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mt-2">
                      <Button type="button" className="flex-1" onClick={handleApply}>
                        Apply
                      </Button>
                      <Button type="button" variant="outline" className="flex-1" onClick={stopEditing}>
                        Cancel
                      </Button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant="danger"
                        className="flex-1"
                        disabled={!isItemModified(editingItem)}
                        onClick={() => setConfirmingRevert(true)}
                      >
                        Revert
                      </Button>
                      <Button
                        type="button"
                        variant="dangerOutline"
                        className="flex-1"
                        disabled={!canDeleteEditingItem}
                        onClick={() => setConfirmingDelete(true)}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex justify-end mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
