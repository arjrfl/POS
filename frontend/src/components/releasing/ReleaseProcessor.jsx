import { useEffect, useMemo, useRef, useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { ItemEditModal } from './ItemEditModal'
import { SubstandardResolution } from './SubstandardResolution'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

const ROW_STATUS_STYLE = {
  exact: 'bg-green-50 border-l-4 border-l-green-400',
  heavier: 'bg-yellow-50 border-l-4 border-l-yellow-400',
  lighter: 'bg-blue-50 border-l-4 border-l-blue-400',
}

const DOT_COLOR = {
  exact: 'bg-green-500',
  heavier: 'bg-yellow-500',
  lighter: 'bg-blue-500',
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

export function ReleaseProcessor({
  transaction,
  onConfirmReady,
  onConfirmWeights,
  onResolve,
  onCompleteExact,
  submitting,
}) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: products } = useProducts()

  // itemStatuses/itemActualValues are keyed by transaction_item_id and reset
  // whenever a different transaction is selected — Releasing.jsx remounts this
  // component (key={transaction.id}) precisely so this local state can't leak
  // between transactions.
  const [itemStatuses, setItemStatuses] = useState({})
  // { [itemId]: { actualWeight, actualUnitCount, actualQty } } — actualWeight
  // may be null (reference-only field, allowed empty)
  const [itemActualValues, setItemActualValues] = useState({})
  const [editingItemId, setEditingItemId] = useState(null)
  const [reEditConfirmId, setReEditConfirmId] = useState(null)

  const productsById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
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
          estimated_weight_kg: item.estimated_weight_kg,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
        }
      })
  }, [transaction, productsById])

  const isOnline = transaction?.customer_type === 'online'
  const weightConfirmed = transaction?.actual_amount != null
  const balanceDue = weightConfirmed ? Number(transaction.balance_due) : null
  const allItemsConfirmed = displayItems.length > 0 && displayItems.every((item) => itemStatuses[item.id])

  // Fires once every row has been confirmed locally, and again any time a
  // confirmed item is re-edited afterward — no permanent lock, so the batch
  // sent to /confirm-weight always reflects the latest weights. The signature
  // guard (not just allItemsConfirmed) is what makes re-edits actually resend:
  // allItemsConfirmed stays true across a re-edit, but the payload changes.
  const lastSentRef = useRef(null)
  useEffect(() => {
    if (!allItemsConfirmed || submitting) return
    const payload = displayItems.map((item) => {
      const values = itemActualValues[item.id]
      return {
        transaction_item_id: item.id,
        actual_weight_kg: values.actualWeight != null ? String(values.actualWeight) : null,
        actual_unit_count: values.actualUnitCount,
        actual_quantity_kg: String(values.actualQty),
      }
    })
    const signature = JSON.stringify(payload)
    if (lastSentRef.current === signature) return
    lastSentRef.current = signature
    onConfirmWeights(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItemsConfirmed, itemActualValues, submitting])

  if (!transaction) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500 italic">Select a transaction from the queue to process it</p>
      </div>
    )
  }

  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]
  const editingItem = displayItems.find((item) => item.id === editingItemId) ?? null
  const creditApplied = Number(transaction.credit_applied) || 0
  // total_due is fixed at Payment time as estimated_amount - credit_applied (+ balance_settled)
  // and is never recomputed from actual_amount once Releasing confirms weights, so adding
  // credit_applied back is what actually reconstructs the pre-credit total at every phase.
  const originalTotal = Number(transaction.total_due) + creditApplied

  const handleConfirmItem = (itemId, values, status) => {
    setItemActualValues((prev) => ({ ...prev, [itemId]: values }))
    setItemStatuses((prev) => ({ ...prev, [itemId]: status }))
    setEditingItemId(null)
  }

  const handleEditClick = (item) => {
    if (itemStatuses[item.id]) {
      setReEditConfirmId(item.id)
    } else {
      setEditingItemId(item.id)
    }
  }

  return (
    <Card className="flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex-shrink-0">
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

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-200">
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
                {!isOnline && <th className="py-2 pl-1"></th>}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item) => {
                const status = itemStatuses[item.id]
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-gray-100 last:border-b-0 align-top ${ROW_STATUS_STYLE[status] ?? 'bg-white'}`}
                  >
                    <td className="py-2 pr-2 text-gray-700">{item.quantity_kg.toFixed(3)}</td>
                    <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-gray-900">{item.product_name}</div>
                      {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                    </td>
                    <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                    <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                    {!isOnline && (
                      <td className="py-2 pl-1 relative">
                        <div className="flex items-center gap-1.5 justify-end">
                          {status && (
                            <span className={`w-2 h-2 rounded-full ${DOT_COLOR[status]}`} aria-hidden="true" />
                          )}
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleEditClick(item)}
                            className="text-gray-500 hover:text-primary disabled:opacity-40"
                            aria-label={`Edit ${item.product_name}`}
                          >
                            <PencilIcon />
                          </button>
                        </div>

                        {reEditConfirmId === item.id && (
                          <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-md shadow-lg p-2 text-xs whitespace-nowrap">
                            <p className="text-gray-700 mb-1.5">
                              This item is already confirmed.
                              <br />
                              Edit it again?
                            </p>
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setReEditConfirmId(null)
                                  setEditingItemId(item.id)
                                }}
                                className="px-2 py-1 rounded bg-primary text-white hover:bg-primary-dark"
                              >
                                Yes, Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setReEditConfirmId(null)}
                                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-shrink-0 flex flex-col gap-4">
        <div className="border-t border-gray-200 pt-3 flex flex-col gap-1">
          {creditApplied > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Original Total</span>
                <span className="text-gray-900">{formatCurrency(originalTotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-green-700">
                <span>Credit Applied</span>
                <span>-{formatCurrency(creditApplied)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">TOTAL DUE</span>
            <span className="text-2xl font-bold text-primary">{formatCurrency(transaction.total_due)}</span>
          </div>
        </div>

        <div>
          {isOnline ? (
            <Button type="button" disabled={submitting} onClick={onConfirmReady} className="w-full">
              {submitting ? 'Confirming...' : '✓ Confirm Items Ready'}
            </Button>
          ) : weightConfirmed ? (
            balanceDue === 0 ? (
              <Button type="button" variant="success" disabled={submitting} onClick={onCompleteExact} className="w-full">
                {submitting ? 'Completing...' : 'Complete Transaction'}
              </Button>
            ) : (
              <SubstandardResolution
                transaction={transaction}
                onSendToPayment={() => onResolve('Sent to Payment team')}
                submitting={submitting}
              />
            )
          ) : (
            allItemsConfirmed && <p className="text-sm text-gray-500 text-center">Confirming weights...</p>
          )}
        </div>
      </div>

      {editingItem && (
        <ItemEditModal
          item={editingItem}
          initialValues={itemActualValues[editingItem.id]}
          onConfirm={handleConfirmItem}
          onCancel={() => setEditingItemId(null)}
        />
      )}
    </Card>
  )
}
