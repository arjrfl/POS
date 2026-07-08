import { useState } from 'react'
import { PageLayout } from '../components/layout/PageLayout'
import { CustomerSelector } from '../components/walkin/CustomerSelector'
import { ProductSelector } from '../components/walkin/ProductSelector'
import { OrderItemsList } from '../components/walkin/OrderItemsList'
import { OrderSummaryPanel } from '../components/walkin/OrderSummaryPanel'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { post } from '../services/api'

function initialState() {
  return { customer: null, customerType: 'walk_in', items: [] }
}

export default function WalkIn() {
  const [{ customer, customerType, items }, setState] = useState(initialState)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState(null)

  const netBalance = customer ? Number(customer.net_balance) : 0
  const hasBalanceItem = items.some((item) => item.item_type === 'balance_settlement')
  const hasCreditItem = items.some((item) => item.item_type === 'credit_usage')

  const subtotal = items
    .filter((item) => item.item_type === 'product')
    .reduce((sum, item) => sum + item.subtotal, 0)
  const balanceSettled = items.find((item) => item.item_type === 'balance_settlement')?.amount ?? 0
  const creditApplied = items.find((item) => item.item_type === 'credit_usage')?.amount ?? 0
  const totalDue = subtotal + balanceSettled - creditApplied

  const handleSelectCustomer = (selected) => {
    setState((prev) => ({ ...prev, customer: selected, items: [] }))
    setError('')
  }

  const handleCustomerTypeChange = (type) => {
    setState((prev) => ({ ...prev, customerType: type }))
  }

  const handleAddProduct = (product) => {
    // ProductSelector already computes qty/subtotal for live preview; the
    // backend recomputes both authoritatively from unit_count at creation time.
    setState((prev) => ({
      ...prev,
      items: [...prev.items, { id: crypto.randomUUID(), ...product }],
    }))
  }

  const handleAddBalanceSettlement = (amount, referenceTransactionId) => {
    setState((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: crypto.randomUUID(),
          item_type: 'balance_settlement',
          amount,
          reference_transaction_id: referenceTransactionId,
        },
      ],
    }))
  }

  const handleAddCreditUsage = (amount, referenceTransactionId) => {
    setState((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: crypto.randomUUID(),
          item_type: 'credit_usage',
          amount,
          reference_transaction_id: referenceTransactionId,
        },
      ],
    }))
  }

  const handleRemoveItem = (id) => {
    setState((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }))
  }

  const handleUpdateAmount = (id, rawAmount) => {
    const amount = Number(rawAmount)
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, amount } : item)),
    }))
  }

  function validate() {
    if (!customer) return 'Select a customer first.'

    const hasProductItem = items.some((item) => item.item_type === 'product')
    if (!hasProductItem && !hasBalanceItem) {
      return 'Add at least one product, or settle a balance.'
    }

    if (creditApplied > 0 && creditApplied > netBalance) {
      return "Cannot apply more credit than the customer's balance."
    }

    if (balanceSettled > 0 && balanceSettled > Math.abs(netBalance)) {
      return 'Cannot settle more than the customer owes.'
    }

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
        items: items.map((item) =>
          item.item_type === 'product'
            ? {
                item_type: 'product',
                product_id: item.product_id,
                unit_count: item.unit_count,
                unit_price: item.unit_price,
              }
            : {
                item_type: item.item_type,
                reference_transaction_id: item.reference_transaction_id,
              },
        ),
        credit_applied: creditApplied,
        balance_settled: balanceSettled,
      }

      const transaction = await post('/transactions', payload)
      setConfirmation({ order_number: transaction.order_number })
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
    <PageLayout title="Walk-In — New Transaction">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col gap-6">
          <CustomerSelector
            value={customer}
            onSelect={handleSelectCustomer}
            onAddBalanceSettlement={handleAddBalanceSettlement}
            onAddCreditUsage={handleAddCreditUsage}
            hasBalanceItem={hasBalanceItem}
            hasCreditItem={hasCreditItem}
          />

          <div>
            <span className="text-sm font-medium text-gray-700">Customer type</span>
            <div className="mt-1 flex gap-2">
              {['walk_in', 'online'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleCustomerTypeChange(type)}
                  className={`px-4 py-2 rounded-md text-sm font-medium border ${
                    customerType === type
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {type === 'walk_in' ? 'Walk-In' : 'Online'}
                </button>
              ))}
            </div>
          </div>

          <ProductSelector onAddItem={handleAddProduct} />

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Order items</h3>
            <OrderItemsList
              items={items}
              onRemove={handleRemoveItem}
              onUpdateAmount={handleUpdateAmount}
              maxBalanceAmount={Math.abs(netBalance)}
              maxCreditAmount={netBalance}
            />
          </div>
        </Card>

        <OrderSummaryPanel
          customer={customer}
          customerType={customerType}
          items={items}
          subtotal={subtotal}
          balanceSettled={balanceSettled}
          creditApplied={creditApplied}
          totalDue={totalDue}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      </div>

      <Modal open={!!confirmation} onClose={handleNewTransaction} title="Transaction Created">
        <p className="text-gray-700">
          Order number: <strong>{confirmation?.order_number}</strong>
        </p>
        <Button className="w-full mt-4" onClick={handleNewTransaction}>
          New Transaction
        </Button>
      </Modal>
    </PageLayout>
  )
}
