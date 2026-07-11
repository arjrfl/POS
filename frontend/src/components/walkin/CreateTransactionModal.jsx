import { useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { CustomerSelector } from './CustomerSelector'
import { ProductSelector } from './ProductSelector'
import { OrderSummaryPanel } from './OrderSummaryPanel'
import { post } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_LABEL } from '../../utils/customerType'
import { generateId } from '../../utils/id'

function initialState() {
  return { customer: null, customerType: null, items: [] }
}

export function CreateTransactionModal({ open, onClose, onCreated }) {
  const [{ customer, customerType, items }, setState] = useState(initialState)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [changeGuard, setChangeGuard] = useState(null) // null | 'customer' | 'customer_type'
  const [discardGuard, setDiscardGuard] = useState(false)

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  const hasData = !!customer || items.length > 0
  const canSubmit = !!customer && !!customerType && items.length > 0

  const resetForm = () => {
    setState(initialState())
    setError('')
    setConfirmation(null)
    setChangeGuard(null)
    setDiscardGuard(false)
  }

  const clearCustomer = () => {
    setState((prev) => ({ ...prev, customer: null, items: [] }))
    setError('')
  }

  const clearCustomerType = () => {
    setState((prev) => ({ ...prev, customerType: null, items: [] }))
    setError('')
  }

  const handleSelectCustomer = (selected) => {
    setState((prev) => ({ ...prev, customer: selected, items: [] }))
    setError('')
  }

  const requestClearCustomer = () => {
    if (items.length > 0) setChangeGuard('customer')
    else clearCustomer()
  }

  const requestClearCustomerType = () => {
    if (items.length > 0) setChangeGuard('customer_type')
    else clearCustomerType()
  }

  const handleConfirmChangeGuard = () => {
    if (changeGuard === 'customer') clearCustomer()
    else if (changeGuard === 'customer_type') clearCustomerType()
    setChangeGuard(null)
  }

  const handleCancelChangeGuard = () => setChangeGuard(null)

  const handleCustomerTypeChange = (type) => {
    setState((prev) => ({ ...prev, customerType: type || null }))
  }

  const handleAddProduct = (product) => {
    setState((prev) => ({
      ...prev,
      items: [...prev.items, { id: generateId(), ...product }],
    }))
  }

  const handleRemoveItem = (id) => {
    setState((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }))
  }

  function validate() {
    if (!customer) return 'Please select a customer'
    if (!customerType) return 'Please select a customer type'
    if (items.length === 0) return 'Please add at least one item'
    return null
  }

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const payload = {
        customer_id: customer.id,
        customer_type: customerType,
        items: items.map((item) => ({
          item_type: 'product',
          product_id: item.product_id,
          estimated_weight_kg: item.estimated_weight_kg,
          unit_price: item.unit_price,
          unit_count: item.unit_count,
          quantity_kg: item.quantity_kg,
        })),
      }

      const transaction = await post('/transactions', payload)
      setConfirmation({
        order_number: transaction.order_number,
        customer_name: customer.full_name,
        total_due: total,
        customer_type: customerType,
      })
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCloseConfirmation = () => {
    resetForm()
    onClose()
  }

  const requestClose = () => {
    if (confirmation) {
      handleCloseConfirmation()
      return
    }
    if (hasData) {
      setDiscardGuard(true)
    } else {
      resetForm()
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    resetForm()
    onClose()
  }

  return (
    <>
      <FullScreenModal open={open} onClose={requestClose} title="New Transaction">
        <div className="grid grid-cols-2 gap-6 h-full min-h-0">
          <div className="h-full min-h-0 overflow-y-auto flex flex-col gap-6 pr-2">
            <CustomerSelector value={customer} onSelect={handleSelectCustomer} onClear={requestClearCustomer} />

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700">Customer Type</span>
                {customerType && (
                  <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                    {CUSTOMER_TYPE_LABEL[customerType]}
                    <button
                      type="button"
                      onClick={requestClearCustomerType}
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-primary/20"
                      aria-label="Clear customer type"
                    >
                      &#10005;
                    </button>
                  </span>
                )}
              </div>
              <select
                id="customer-type-select"
                value={customerType ?? ''}
                disabled={!!customerType}
                onChange={(e) => handleCustomerTypeChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="" disabled>
                  Select Customer Type
                </option>
                <option value="walk_in">Walk-In</option>
                <option value="online">Online</option>
              </select>
            </div>

            <ProductSelector onAddItem={handleAddProduct} />
          </div>

          <OrderSummaryPanel
            customer={customer}
            customerType={customerType}
            items={items}
            total={total}
            onRemoveItem={handleRemoveItem}
            footer={
              <>
                {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
                <Button
                  type="button"
                  className="w-full mt-3"
                  disabled={submitting || !canSubmit}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Submitting...' : 'Submit Transaction'}
                </Button>
              </>
            }
          />
        </div>
      </FullScreenModal>

      <Modal
        open={!!changeGuard}
        onClose={handleCancelChangeGuard}
        title={`Change ${changeGuard === 'customer' ? 'Customer' : 'Customer Type'}?`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">
            You have {items.length} item{items.length === 1 ? '' : 's'} in your order. Changing this will clear all
            order items. Do you want to continue?
          </p>
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={handleConfirmChangeGuard}>
              Yes, Clear and Change
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={handleCancelChangeGuard}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={discardGuard} onClose={() => setDiscardGuard(false)} title="Discard Transaction?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Discard this transaction? All entered data will be lost.</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" className="flex-1" onClick={handleConfirmDiscard}>
              Yes, Discard
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setDiscardGuard(false)}>
              Keep Editing
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!confirmation} onClose={handleCloseConfirmation} title="Transaction Created">
        <div className="flex flex-col gap-1">
          <div className="text-3xl font-bold text-primary">{confirmation?.order_number}</div>
          <div className="text-gray-900 font-medium">{confirmation?.customer_name}</div>
          <div className="text-gray-700">{formatCurrency(confirmation?.total_due ?? 0)}</div>
          <div className="text-sm text-gray-500">
            {confirmation?.customer_type === 'walk_in' ? 'Walk-In' : 'Online'}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            {confirmation?.customer_type === 'walk_in'
              ? 'Customer directed to Payment team'
              : 'Order sent to Releasing team'}
          </p>
        </div>
        <div className="flex gap-2 mt-4">
          <Button className="flex-1" onClick={resetForm}>
            New Transaction
          </Button>
          <Button variant="outline" className="flex-1" onClick={handleCloseConfirmation}>
            Close
          </Button>
        </div>
      </Modal>
    </>
  )
}
