import { useState } from 'react'
import { PageLayout } from '../components/layout/PageLayout'
import { CustomerSelector } from '../components/walkin/CustomerSelector'
import { ProductSelector } from '../components/walkin/ProductSelector'
import { OrderSummaryPanel } from '../components/walkin/OrderSummaryPanel'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { post } from '../services/api'
import { formatCurrency } from '../utils/currency'

const CUSTOMER_TYPE_LABEL = { walk_in: 'Walk-In', online: 'Online' }

function initialState() {
  return { customer: null, customerType: null, items: [] }
}

export default function WalkIn() {
  const [{ customer, customerType, items }, setState] = useState(initialState)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [changeGuard, setChangeGuard] = useState(null) // null | 'customer' | 'customer_type'

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)

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
    if (items.length > 0) {
      setChangeGuard('customer')
    } else {
      clearCustomer()
    }
  }

  const requestClearCustomerType = () => {
    if (items.length > 0) {
      setChangeGuard('customer_type')
    } else {
      clearCustomerType()
    }
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
    // ProductSelector already computes qty/subtotal for live preview; the
    // backend recomputes both authoritatively from unit_count at creation time.
    setState((prev) => ({
      ...prev,
      items: [...prev.items, { id: crypto.randomUUID(), ...product }],
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
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNewTransaction = () => {
    setState(initialState())
    setError('')
    setConfirmation(null)
  }

  return (
    <PageLayout title="Receiver — New Transaction">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
        <Card className="h-full flex flex-col gap-6">
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
        </Card>

        <OrderSummaryPanel
          customer={customer}
          customerType={customerType}
          items={items}
          total={total}
          onRemoveItem={handleRemoveItem}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      </div>

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

      <Modal open={!!confirmation} onClose={handleNewTransaction} title="Transaction Created">
        <div className="flex flex-col gap-1">
          <div className="text-3xl font-bold text-primary">{confirmation?.order_number}</div>
          <div className="text-gray-900 font-medium">{confirmation?.customer_name}</div>
          <div className="text-gray-700">{formatCurrency(confirmation?.total_due ?? 0)}</div>
          <div className="text-sm text-gray-500">
            {confirmation?.customer_type === 'walk_in' ? 'Walk-In' : 'Online'}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            {confirmation?.customer_type === 'walk_in'
              ? 'Walk-In: Customer directed to Payment team'
              : 'Online: Order sent to Releasing team'}
          </p>
        </div>
        <Button className="w-full mt-4" onClick={handleNewTransaction}>
          New Transaction
        </Button>
      </Modal>
    </PageLayout>
  )
}
