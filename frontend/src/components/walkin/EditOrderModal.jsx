import { useEffect, useMemo, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { ProductSelector } from './ProductSelector'
import { OrderSummaryPanel } from './OrderSummaryPanel'
import { useProducts } from '../../hooks/useProducts'
import { useCustomer } from '../../hooks/useCustomer'
import { patch, post } from '../../services/api'
import { CUSTOMER_TYPE_LABEL } from '../../utils/customerType'
import { generateId } from '../../utils/id'

function initialItems(transaction) {
  // product_name/brand_name aren't on TransactionItemResponse (only product_id) —
  // resolved once the products list loads, see the hydration effect below.
  return transaction.items.map((item) => ({
    id: generateId(),
    item_type: 'product',
    product_id: item.product_id,
    product_name: null,
    brand_name: null,
    estimated_weight_kg: item.estimated_weight_kg,
    unit_price: Number(item.unit_price),
    unit_count: item.unit_count,
    quantity_kg: Number(item.quantity_kg),
    subtotal: Number(item.subtotal),
  }))
}

export function EditOrderModal({ transaction, onClose, onSent }) {
  const { data: products } = useProducts()
  const { data: customer } = useCustomer(transaction.customer_id)
  const productsById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])

  const [items, setItems] = useState(() => initialItems(transaction))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [closeGuard, setCloseGuard] = useState(false)

  // Hydrate names once the products list resolves — the lazy useState initializer
  // above only runs once and may run before the products query has data yet.
  useEffect(() => {
    if (!products) return
    setItems((prev) =>
      prev.map((item) =>
        item.product_name == null
          ? {
              ...item,
              product_name: productsById.get(item.product_id)?.product_name ?? `Product #${item.product_id}`,
              brand_name: productsById.get(item.product_id)?.brand_name ?? null,
            }
          : item,
      ),
    )
  }, [products, productsById])

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)

  const handleAddProduct = (product) => {
    setItems((prev) => [...prev, { id: generateId(), ...product }])
  }

  const handleRemoveItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  const handleSaveAndSend = async () => {
    if (items.length === 0) {
      setError('Please add at least one item')
      return
    }

    setError('')
    setSaving(true)
    try {
      await patch(`/transactions/${transaction.id}/items`, {
        items: items.map((item) => ({
          item_type: 'product',
          product_id: item.product_id,
          estimated_weight_kg: item.estimated_weight_kg,
          unit_price: item.unit_price,
          unit_count: item.unit_count,
          quantity_kg: item.quantity_kg,
        })),
      })
      await post(`/transactions/${transaction.id}/resubmit`)
      onSent()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRelease = async () => {
    setSaving(true)
    try {
      await post(`/transactions/${transaction.id}/release`)
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const requestClose = () => setCloseGuard(true)

  const handleConfirmRelease = async () => {
    setCloseGuard(false)
    await handleRelease()
  }

  return (
    <>
      <FullScreenModal open onClose={requestClose} title={`Edit Order — ${transaction.order_number}`}>
        <div className="grid grid-cols-2 gap-6 h-full min-h-0">
          <div className="h-full min-h-0 overflow-y-auto flex flex-col gap-6 p-2">
            <div>
              <span className="text-sm font-medium text-gray-700">Customer</span>
              <div className="mt-1">
                <span className="inline-flex items-center px-3 py-0.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  {customer?.full_name ?? '...'}
                </span>
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-gray-700">Customer Type</span>
              <div className="mt-1">
                <span className="inline-flex items-center px-3 py-0.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  {CUSTOMER_TYPE_LABEL[transaction.customer_type]}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500 -mt-4">Customer and type cannot be changed</p>

            <ProductSelector onAddItem={handleAddProduct} />
          </div>

          <OrderSummaryPanel
            customer={customer}
            customerType={transaction.customer_type}
            items={items}
            total={total}
            onRemoveItem={handleRemoveItem}
            footer={
              <div className="flex flex-col gap-2 mt-3">
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="button" className="w-full" disabled={saving} onClick={handleSaveAndSend}>
                  {saving ? 'Saving...' : 'Save & Send to Payment'}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={handleRelease}>
                  Cancel
                </Button>
              </div>
            }
          />
        </div>
      </FullScreenModal>

      <Modal open={closeGuard} onClose={() => setCloseGuard(false)} title="Stop Editing?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">
            Stop editing? The transaction will return to the queue for another team member to pick up.
          </p>
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={handleConfirmRelease}>
              Yes, Release
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setCloseGuard(false)}>
              Keep Editing
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
