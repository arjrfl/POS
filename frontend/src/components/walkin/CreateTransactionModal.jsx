import { useEffect, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { CustomerSelector } from './CustomerSelector'
import { ProductSelector } from './ProductSelector'
import { OrderSummaryPanel } from './OrderSummaryPanel'
import { ProductReferenceTable } from './ProductReferenceTable'
import { post } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_LABEL } from '../../utils/customerType'
import { generateId } from '../../utils/id'
import { useAuthStore } from '../../store/authStore'
import { loadReceiverDraft, saveReceiverDraft, clearReceiverDraft } from '../../utils/receiverDraft'

function initialState(draft) {
  if (draft) {
    return {
      customer: draft.customer ?? null,
      customerType: draft.customerType ?? null,
      items: Array.isArray(draft.items) ? draft.items : [],
      settleOnly: !!draft.settleOnly,
    }
  }
  return { customer: null, customerType: null, items: [], settleOnly: false }
}

export function CreateTransactionModal({ open, onClose, onCreated, showToast }) {
  const username = useAuthStore((state) => state.user?.username)
  const [{ customer, customerType, items, settleOnly }, setState] = useState(() =>
    initialState(loadReceiverDraft(username)),
  )
  const [editingRowId, setEditingRowId] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [changeGuard, setChangeGuard] = useState(null) // null | 'customer' | 'customer_type'
  const [discardGuard, setDiscardGuard] = useState(false)
  const [settleOnlyGuard, setSettleOnlyGuard] = useState(false)
  const [deleteAllGuard, setDeleteAllGuard] = useState(false)
  const [isReferenceExpanded, setIsReferenceExpanded] = useState(false)

  // Gross outstanding balance (customer.total_balance — same
  // get_outstanding_balance_total aggregation as Admin's TOTAL BALANCE and
  // Payment's balance checkboxes), NOT customer.net_balance — net_balance nets
  // against credit and understates what's owed whenever this customer also
  // carries credit. Receiver's checkbox always settles the FULL outstanding
  // set (no per-entry selection like Payment has), so this is also exactly
  // the amount sent as balance_settled below.
  const absBalance = customer ? Number(customer.total_balance) : 0
  const hasBalance = !!customer && absBalance > 0

  const total = settleOnly ? absBalance : items.reduce((sum, item) => sum + item.subtotal, 0)
  // Drives Cancel's confirm-before-discard gate — customerType is included
  // (not just customer/items/settleOnly) since a user can pick a customer
  // type before ever selecting a customer, and that alone still counts as
  // "entered information" worth confirming before discarding.
  const hasData = !!customer || !!customerType || items.length > 0 || settleOnly
  const canSubmit = settleOnly
    ? !!customer && !!customerType
    : !!customer && !!customerType && items.length > 0

  const resetForm = () => {
    setState(initialState(null))
    setEditingRowId(null)
    setError('')
    setConfirmation(null)
    setChangeGuard(null)
    setDiscardGuard(false)
    setSettleOnlyGuard(false)
    clearReceiverDraft(username)
  }

  // Mirror open/closed + form fields to localStorage so a reload can restore an
  // in-progress transaction. Debounced to avoid excessive writes while typing.
  useEffect(() => {
    if (!username) return
    const handle = setTimeout(() => {
      saveReceiverDraft(username, { open, customer, customerType, items, settleOnly })
    }, 500)
    return () => clearTimeout(handle)
  }, [username, open, customer, customerType, items, settleOnly])

  const clearCustomer = () => {
    setState((prev) => ({ ...prev, customer: null, items: [], settleOnly: false }))
    setEditingRowId(null)
    setError('')
  }

  const clearCustomerType = () => {
    setState((prev) => ({ ...prev, customerType: null, items: [] }))
    setEditingRowId(null)
    setError('')
  }

  const handleSelectCustomer = (selected) => {
    setState((prev) => ({ ...prev, customer: selected, items: [], settleOnly: false }))
    setEditingRowId(null)
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
    setEditingRowId((prev) => (prev === id ? null : prev))
  }

  const startEdit = (rowId) => setEditingRowId(rowId)

  const cancelEdit = () => setEditingRowId(null)

  const updateEdit = (rowId, newValues) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === rowId ? { ...item, ...newValues } : item)),
    }))
    setEditingRowId(null)
  }

  const requestToggleSettleOnly = (checked) => {
    if (checked && items.length > 0) {
      setSettleOnlyGuard(true)
      return
    }
    setState((prev) => ({ ...prev, settleOnly: checked }))
  }

  const handleConfirmSettleOnlyGuard = () => {
    setState((prev) => ({ ...prev, items: [], settleOnly: true }))
    setEditingRowId(null)
    setSettleOnlyGuard(false)
  }

  const handleCancelSettleOnlyGuard = () => setSettleOnlyGuard(false)

  const requestDeleteAll = () => {
    if (items.length > 0) setDeleteAllGuard(true)
  }

  const handleConfirmDeleteAll = () => {
    setState((prev) => ({ ...prev, items: [] }))
    setEditingRowId(null)
    setDeleteAllGuard(false)
  }

  const handleCancelDeleteAll = () => setDeleteAllGuard(false)

  function validate() {
    if (!customer) return 'Please select a customer'
    if (!customerType) return 'Please select a customer type'
    if (!settleOnly && items.length === 0) return 'Please add at least one item'
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
      const payload = settleOnly
        ? {
            customer_id: customer.id,
            customer_type: customerType,
            transaction_type: 'balance_settlement',
            items: [],
            balance_settled: absBalance,
            credit_applied: 0,
          }
        : {
            customer_id: customer.id,
            customer_type: customerType,
            items: items.map((item) => ({
              item_type: 'product',
              product_id: item.product_id,
              estimated_weight_kg: item.estimated_weight_kg,
              unit_price: item.unit_price,
              unit_count: item.unit_count,
              quantity_kg: item.quantity_kg,
              tabulation_breakdown: item.tabulation_breakdown ?? null,
            })),
          }

      const transaction = await post('/transactions', payload)
      clearReceiverDraft(username)
      setConfirmation({
        order_number: transaction.order_number,
        customer_name: customer.full_name,
        total_due: total,
        customer_type: customerType,
        is_balance_settlement: settleOnly,
      })
      onCreated()
    } catch (err) {
      // Backend rejection (e.g. unpriced product, insufficient stock) — surfaced
      // as a toast, not inline, and the modal stays open with entries intact
      // (no resetForm call here).
      showToast?.(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCloseConfirmation = () => {
    resetForm()
    onClose()
  }

  // Back — non-destructive close. Draft state lives in this component's own
  // React state (CreateTransactionModal never unmounts when the modal is
  // "closed" — FullScreenModal just stops rendering its contents), so simply
  // closing without calling resetForm()/clearReceiverDraft() is enough for
  // everything entered to still be there next time this modal is opened.
  const requestBack = () => {
    if (confirmation) {
      handleCloseConfirmation()
      return
    }
    setError('')
    onClose()
  }

  // Cancel — destructive close, gated behind a confirm popup whenever any
  // meaningful data has been entered (see hasData above).
  const requestCancel = () => {
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
      <FullScreenModal
        open={open}
        onClose={requestCancel}
        title="New Transaction"
        headerActions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={requestBack}>
              Back
            </Button>
            <Button type="button" variant="outline" onClick={requestCancel}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="flex flex-col lg:flex-row gap-6 h-full min-h-0 overflow-y-auto lg:overflow-visible">
          <div className="order-3 lg:order-1 lg:flex-1 lg:min-w-0 lg:h-full lg:min-h-0">
            <button
              type="button"
              onClick={() => setIsReferenceExpanded((prev) => !prev)}
              className="lg:hidden w-full flex items-center justify-between px-4 py-2 border border-brand-black/20 rounded-lg bg-gray-100 text-sm font-medium mb-2"
            >
              <span>Product Reference</span>
              <span>{isReferenceExpanded ? '▾ Hide' : '▸ Show'}</span>
            </button>
            <div className={`${isReferenceExpanded ? 'block' : 'hidden'} lg:block lg:h-full lg:min-h-0`}>
              <ProductReferenceTable />
            </div>
          </div>

          <div className="order-1 lg:order-2 flex flex-col gap-6 lg:w-80 lg:shrink-0 lg:h-full lg:min-h-0 lg:overflow-y-auto pr-2">
            <div>
              <CustomerSelector value={customer} onSelect={handleSelectCustomer} onClear={requestClearCustomer} />

              {hasBalance && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 mt-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settleOnly}
                      onChange={(e) => requestToggleSettleOnly(e.target.checked)}
                      className="accent-brand-gold mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-red-800">Balance Settlement Only</div>
                      <div className="text-xs text-red-600">Customer owes {formatCurrency(absBalance)}</div>
                      <div className="text-xs text-red-600">
                        Check this if customer is only here to pay their outstanding balance.
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </div>

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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="" disabled>
                  Select Customer Type
                </option>
                <option value="walk_in">Walk-In</option>
                <option value="online">Online</option>
              </select>
            </div>

            <div className="relative">
              <div className={settleOnly ? 'opacity-50 pointer-events-none' : ''}>
                <ProductSelector
                  onAddItem={handleAddProduct}
                  editingItem={items.find((item) => item.id === editingRowId) ?? null}
                  onUpdateItem={updateEdit}
                  onCancelEdit={cancelEdit}
                  enableTabulation
                />
              </div>
              {settleOnly && (
                <div className="absolute inset-0 flex items-center justify-center px-4">
                  <span className="text-xs text-gray-400 italic text-center">
                    Product selection disabled for balance settlement only
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="order-2 lg:order-3 lg:w-1/2 lg:shrink-0 lg:h-full lg:min-h-0">
            <OrderSummaryPanel
              customer={customer}
              customerType={customerType}
              items={items}
              total={total}
              onRemoveItem={handleRemoveItem}
              onEditItem={settleOnly ? null : startEdit}
              editingRowId={editingRowId}
              onDeleteAll={requestDeleteAll}
              balanceSettlementRow={settleOnly}
              footer={
                <>
                  {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
                  <Button
                    type="button"
                    className="w-full mt-3"
                    disabled={submitting || !canSubmit}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Submitting...' : settleOnly ? 'Submit Balance Settlement' : 'Submit Transaction'}
                  </Button>
                </>
              }
            />
          </div>
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

      <Modal open={settleOnlyGuard} onClose={handleCancelSettleOnlyGuard} title="Clear Order Items?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Checking this will remove all items from your order. Continue?</p>
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={handleConfirmSettleOnlyGuard}>
              Yes, Clear Items
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={handleCancelSettleOnlyGuard}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteAllGuard} onClose={handleCancelDeleteAll} title="Delete all items?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">
            This will remove all {items.length} item{items.length === 1 ? '' : 's'} from this order. This cannot be
            undone.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={handleCancelDeleteAll}>
              Cancel
            </Button>
            <Button type="button" variant="danger" className="flex-1" onClick={handleConfirmDeleteAll}>
              Delete All
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={discardGuard} onClose={() => setDiscardGuard(false)} title="Discard this transaction?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">All entered information will be lost.</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" className="flex-1" onClick={handleConfirmDiscard}>
              Yes, Discard
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setDiscardGuard(false)}>
              No, Keep Editing
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!confirmation}
        onClose={handleCloseConfirmation}
        title={confirmation?.is_balance_settlement ? 'Balance Settlement Created' : 'Transaction Created'}
      >
        {confirmation?.is_balance_settlement ? (
          <div className="flex flex-col gap-1">
            <div className="text-gray-900 font-medium">{confirmation?.customer_name}</div>
            <div className="text-gray-700">Amount to settle: {formatCurrency(confirmation?.total_due ?? 0)}</div>
            <div className="text-sm text-gray-500">
              {confirmation?.customer_type === 'walk_in' ? 'Walk-In' : 'Online'}
            </div>
            <p className="text-sm text-gray-600 mt-2 pt-2 border-t border-gray-200">
              Customer directed to Payment team to complete the balance settlement.
            </p>
            <Button className="mt-4" onClick={resetForm}>
              New Transaction
            </Button>
          </div>
        ) : (
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
            <div className="flex gap-2 mt-4">
              <Button className="flex-1" onClick={resetForm}>
                New Transaction
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleCloseConfirmation}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
