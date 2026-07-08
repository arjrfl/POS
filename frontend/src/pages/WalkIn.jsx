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
  const hasProductItem = items.some((item) => item.item_type === 'product')

  const subtotal = items
    .filter((item) => item.item_type === 'product')
    .reduce((sum, item) => sum + item.subtotal, 0)
  const balanceSettled = items.find((item) => item.item_type === 'balance_settlement')?.amount ?? 0
  const creditApplied = items.find((item) => item.item_type === 'credit_usage')?.amount ?? 0
  const totalDue = subtotal + balanceSettled - creditApplied

  const canSubmit = !!customer && (hasProductItem || hasBalanceItem)

  const handleSelectCustomer = (selected) => {
    setState((prev) => ({ ...prev, customer: selected, items: [] }))
    setError('')
  }

  const handleClearCustomer = () => {
    setState((prev) => ({ ...prev, customer: null, items: [] }))
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
                estimated_weight_kg: item.estimated_weight_kg,
                unit_price: item.unit_price,
                unit_count: item.unit_count,
                quantity_kg: item.quantity_kg,
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
      setConfirmation({
        order_number: transaction.order_number,
        customer_name: customer.full_name,
        total_due: totalDue,
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
    <PageLayout title="Walk-In — New Transaction">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
        <Card className="h-full flex flex-col gap-6">
          <CustomerSelector
            value={customer}
            onSelect={handleSelectCustomer}
            onClear={handleClearCustomer}
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
        </Card>

        <OrderSummaryPanel
          customer={customer}
          items={items}
          subtotal={subtotal}
          balanceSettled={balanceSettled}
          creditApplied={creditApplied}
          totalDue={totalDue}
          onRemoveItem={handleRemoveItem}
          onUpdateAmount={handleUpdateAmount}
          maxBalanceAmount={Math.abs(netBalance)}
          maxCreditAmount={netBalance}
          canSubmit={canSubmit}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      </div>

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
