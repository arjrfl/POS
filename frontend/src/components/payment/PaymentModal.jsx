import { useEffect, useMemo, useRef, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { PaymentConfirmationModal } from './PaymentConfirmationModal'
import { usePaymentMethods } from '../../hooks/usePaymentMethods'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { formatCurrency } from '../../utils/format'
import { PAYMENT_METHOD_LABEL } from '../../utils/paymentMethod'
import { generateId } from '../../utils/id'
import { post, put } from '../../services/api'

const EPS = 0.005
const DRAFT_AUTOSAVE_INTERVAL_MS = 30000

export function PaymentModal({ open, transaction, onClose, onPaid, onParked }) {
  const { data: methods } = usePaymentMethods()
  const { data: customer } = useCustomer(transaction.customer_id)
  const { data: products } = useProducts()

  const [methodId, setMethodId] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [entries, setEntries] = useState([])
  const [closeGuard, setCloseGuard] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [parking, setParking] = useState(false)
  const [parkError, setParkError] = useState('')

  const [collectBalance, setCollectBalance] = useState(false)
  const [balanceAmount, setBalanceAmount] = useState('')
  const [applyCredit, setApplyCredit] = useState(false)
  const [creditAmount, setCreditAmount] = useState('')

  // Fresh form every time the modal opens — no leftover entries from a
  // previously cancelled attempt on this same transaction. Entries themselves
  // are seeded separately below, from any saved drafts.
  useEffect(() => {
    if (open) {
      setMethodId('')
      setRefNumber('')
      setAmount('')
      setCloseGuard(false)
      setShowConfirmation(false)
      setParking(false)
      setParkError('')
      setCollectBalance(false)
      setBalanceAmount('')
      setApplyCredit(false)
      setCreditAmount('')
    }
  }, [open])

  useEffect(() => {
    if (methods?.length && !methodId) {
      const cash = methods.find((m) => m.payment_method_name === 'cash')
      setMethodId(String(cash?.id ?? methods[0].id))
    }
  }, [methods, methodId])

  // Seed the entries table from any saved drafts once per modal open. Draft
  // rows only carry payment_method_id, not method_name, so this waits for
  // payment methods to be loaded to resolve it locally. Deliberately depends
  // only on [open, methods] — not `transaction` — so an incidental transaction
  // refetch while the modal is already open doesn't clobber unsaved typing.
  useEffect(() => {
    if (!open || !methods?.length) return
    const drafts = transaction.payment_drafts ?? []
    if (drafts.length === 0) {
      setEntries([])
      return
    }
    const methodsById = new Map(methods.map((m) => [m.id, m]))
    setEntries(
      drafts.map((d) => ({
        id: generateId(),
        payment_method_id: d.payment_method_id,
        method_name: methodsById.get(d.payment_method_id)?.payment_method_name ?? '',
        amount: Number(d.amount),
        tendered_amount: d.tendered_amount !== null ? Number(d.tendered_amount) : null,
        ref_number: d.ref_number,
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, methods])

  // Background auto-save every 30s while the modal is open — silent, no
  // toast/loading state. A ref keeps the interval itself stable (created once
  // per modal-open) so adding/removing entries doesn't reset the 30s cadence.
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => {
      if (entriesRef.current.length > 0) {
        put(`/transactions/${transaction.id}/payment-drafts`, {
          entries: entriesRef.current.map((e) => ({
            payment_method_id: e.payment_method_id,
            amount: e.amount,
            tendered_amount: e.tendered_amount,
            ref_number: e.ref_number,
          })),
        }).catch((err) => console.error('Payment draft autosave failed:', err))
      }
    }, DRAFT_AUTOSAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open, transaction.id])

  const productsById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const displayItems = useMemo(
    () =>
      transaction.items.map((item) => {
        const product = productsById.get(item.product_id)
        return {
          id: item.id,
          product_name: product?.product_name ?? `Product #${item.product_id}`,
          brand_name: product?.brand_name ?? null,
          unit_count: item.unit_count,
          quantity_kg: Number(item.quantity_kg),
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
        }
      }),
    [transaction, productsById],
  )

  if (!open) return null

  const totalDue = Number(transaction.total_due)
  const isBalanceSettlement = transaction.transaction_type === 'balance_settlement'
  const netBalance = customer ? Number(customer.net_balance) : 0
  const absBalance = Math.abs(netBalance)

  const balanceSettled = collectBalance ? Number(balanceAmount) || 0 : 0
  const creditApplied = applyCredit ? Number(creditAmount) || 0 : 0
  const balanceValid = !collectBalance || (balanceSettled > 0 && balanceSettled <= absBalance)
  const creditValid = !applyCredit || (creditApplied > 0 && creditApplied <= netBalance && creditApplied <= totalDue)

  const finalAmount = totalDue + balanceSettled - creditApplied

  const handleToggleCollectBalance = (checked) => {
    setCollectBalance(checked)
    setBalanceAmount(checked ? String(absBalance) : '')
  }

  const handleToggleApplyCredit = (checked) => {
    setApplyCredit(checked)
    setCreditAmount(checked ? String(Math.min(netBalance, totalDue)) : '')
  }

  const selectedMethod = methods?.find((m) => String(m.id) === methodId)
  const isCash = selectedMethod?.payment_method_name === 'cash'

  const enteredSoFar = entries.reduce((sum, e) => sum + e.amount, 0)
  const remainingOwed = finalAmount - enteredSoFar
  const parsedAmount = Number(amount) || 0
  const previewRemaining = remainingOwed - parsedAmount
  const hasCashEntry = entries.some((e) => e.method_name === 'cash')
  const duplicateCashBlocked = isCash && hasCashEntry

  let previewLabel
  let previewClass
  let overpayBlocked = false
  if (duplicateCashBlocked) {
    previewLabel = 'Only one cash entry is allowed'
    previewClass = 'text-red-600'
  } else if (previewRemaining > EPS) {
    previewLabel = `Remaining: ${formatCurrency(previewRemaining)}`
    previewClass = 'text-red-600'
  } else if (previewRemaining < -EPS) {
    if (isCash) {
      previewLabel = `Change: ${formatCurrency(Math.abs(previewRemaining))}`
      previewClass = 'text-green-700'
    } else {
      previewLabel = 'Cannot exceed remaining amount'
      previewClass = 'text-red-600'
      overpayBlocked = true
    }
  } else {
    previewLabel = 'Fully covered'
    previewClass = 'text-green-700'
  }

  const addDisabled =
    !selectedMethod ||
    parsedAmount <= 0 ||
    (!isCash && refNumber.trim().length === 0) ||
    (!isCash && overpayBlocked) ||
    duplicateCashBlocked

  const handleAddEntry = () => {
    if (addDisabled) return
    // Store exactly what the user typed — never cap to what's still owed.
    // Cash can overpay (produces change); online is already blocked above
    // from ever exceeding the remaining amount.
    setEntries((prev) => [
      ...prev,
      {
        id: generateId(),
        payment_method_id: selectedMethod.id,
        method_name: selectedMethod.payment_method_name,
        amount: Math.round(parsedAmount * 100) / 100,
        tendered_amount: isCash ? parsedAmount : null,
        ref_number: isCash ? null : refNumber.trim(),
      },
    ])
    setAmount('')
    setRefNumber('')
  }

  const handleRemoveEntry = (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const enteredTotal = entries.reduce((sum, e) => sum + e.amount, 0)
  const remainingAfterEntries = finalAmount - enteredTotal
  const changeAmount = -remainingAfterEntries
  const cashEntryCount = entries.filter((e) => e.method_name === 'cash').length

  const confirmDisabled =
    entries.length === 0 ||
    enteredTotal < finalAmount - EPS ||
    entries.some((e) => e.method_name !== 'cash' && !e.ref_number) ||
    cashEntryCount > 1 ||
    !balanceValid ||
    !creditValid

  const requestClose = () => setCloseGuard(true)
  const confirmClose = () => {
    setCloseGuard(false)
    onClose()
  }

  const handleConfirmationDone = (paid) => {
    setShowConfirmation(false)
    onPaid(paid)
  }

  const handleParkFromModal = async () => {
    setParkError('')
    setParking(true)
    try {
      // Save entries before parking so they're recoverable on unpark.
      await put(`/transactions/${transaction.id}/payment-drafts`, {
        entries: entries.map((e) => ({
          payment_method_id: e.payment_method_id,
          amount: e.amount,
          tendered_amount: e.tendered_amount,
          ref_number: e.ref_number,
        })),
      })
      await post(`/transactions/${transaction.id}/park`)
      onParked()
    } catch (err) {
      setParkError(err.message)
      setParking(false)
    }
  }

  return (
    <>
      <FullScreenModal open={open} onClose={requestClose} title={`Process Payment — ${transaction.order_number}`}>
        <div className="h-full flex flex-col min-h-0 max-w-5xl mx-auto">
          <div className="flex-shrink-0 grid grid-cols-3 gap-4 pb-4 border-b border-gray-200">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance / Credit</span>
              {isBalanceSettlement ? (
                <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-800">
                  <span aria-hidden="true">&#8505;</span>
                  <div>
                    <div className="font-semibold">Balance Settlement</div>
                    <p className="mt-1">
                      This transaction is for settling the customer&apos;s outstanding balance. The total already
                      reflects the full balance amount.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {netBalance < 0 && (
                    <div className="flex flex-col gap-2 p-3 rounded-md bg-red-50 border border-red-200">
                      <span className="text-sm font-semibold text-red-800">Customer has Balance</span>
                      <span className="text-2xl font-bold text-red-700">{formatCurrency(absBalance)}</span>
                      <span className="text-xs text-red-600">Outstanding balance owed to store</span>
                      <label className="flex items-center gap-2 mt-1 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={collectBalance}
                          onChange={(e) => handleToggleCollectBalance(e.target.checked)}
                        />
                        Collect balance with this payment
                      </label>
                      {collectBalance && (
                        <>
                          <Input
                            id="balance-amount"
                            type="number"
                            step="0.01"
                            value={balanceAmount}
                            onChange={(e) => setBalanceAmount(e.target.value)}
                          />
                          {!balanceValid && <p className="text-xs text-red-600">Cannot exceed outstanding balance</p>}
                        </>
                      )}
                    </div>
                  )}
                  {netBalance > 0 && (
                    <div className="flex flex-col gap-2 p-3 rounded-md bg-green-50 border border-green-200">
                      <span className="text-sm font-semibold text-green-800">Customer has Credit</span>
                      <span className="text-2xl font-bold text-green-700">{formatCurrency(netBalance)}</span>
                      <span className="text-xs text-green-600">Credit available to use</span>
                      <label className="flex items-center gap-2 mt-1 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={applyCredit}
                          onChange={(e) => handleToggleApplyCredit(e.target.checked)}
                        />
                        Apply credit to this payment
                      </label>
                      {applyCredit && (
                        <>
                          <Input
                            id="credit-amount"
                            type="number"
                            step="0.01"
                            value={creditAmount}
                            onChange={(e) => setCreditAmount(e.target.value)}
                          />
                          {!creditValid && (
                            <p className="text-xs text-red-600">Cannot exceed available credit or order total</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {netBalance === 0 && (
                    <div className="flex flex-col gap-1 p-3 rounded-md bg-gray-100 border border-gray-300">
                      <span className="text-sm text-gray-600">No balance or credit on this account</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Revised Total</span>
              <div className="flex flex-col gap-1 p-3 rounded-md border border-gray-200 text-sm">
                {!isBalanceSettlement && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Original Total</span>
                    <span className="text-gray-900">{formatCurrency(totalDue)}</span>
                  </div>
                )}
                {!isBalanceSettlement && balanceSettled > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Balance Collected</span>
                    <span>+{formatCurrency(balanceSettled)}</span>
                  </div>
                )}
                {!isBalanceSettlement && creditApplied > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Credit Applied</span>
                    <span>-{formatCurrency(creditApplied)}</span>
                  </div>
                )}
                <div className={isBalanceSettlement ? 'flex flex-col' : 'border-t border-gray-200 pt-2 mt-1 flex flex-col'}>
                  <span className="font-semibold text-gray-900">Amount to Collect</span>
                  <span className="text-2xl font-bold text-primary">{formatCurrency(finalAmount)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment Entry</span>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="payment-method" className="text-sm font-medium text-gray-700">
                    Payment Method
                  </label>
                  <select
                    id="payment-method"
                    value={methodId}
                    onChange={(e) => setMethodId(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
                  >
                    {(methods ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {PAYMENT_METHOD_LABEL[m.payment_method_name] ?? m.payment_method_name}
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  id="ref-number"
                  label="Reference Number"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  disabled={isCash}
                  className="disabled:bg-gray-100 disabled:text-gray-500"
                />

                <Input
                  id="entry-amount"
                  label="Amount for this entry"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className={`text-sm font-semibold ${previewClass}`}>{previewLabel}</div>

                <Button type="button" variant="outline" disabled={addDisabled} onClick={handleAddEntry}>
                  + Add Payment Entry
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto py-4">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">No payment entries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-2 font-medium">METHOD</th>
                    <th className="py-2 pr-2 font-medium">AMOUNT</th>
                    <th className="py-2 pr-2 font-medium">REFERENCE</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-2 pr-2 text-gray-900">
                        {PAYMENT_METHOD_LABEL[entry.method_name] ?? entry.method_name}
                      </td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(entry.amount)}</td>
                      <td className="py-2 pr-2 text-gray-700">{entry.ref_number || '—'}</td>
                      <td className="py-2 pl-1">
                        <button
                          type="button"
                          onClick={() => handleRemoveEntry(entry.id)}
                          className="text-red-600 hover:text-red-800 font-bold text-lg leading-none"
                          aria-label="Remove entry"
                        >
                          &#10005;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex-shrink-0">
            <div className="flex flex-col gap-1 pt-3 border-t border-gray-200 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-700">Total Entered</span>
                <span className="font-semibold text-gray-900">{formatCurrency(enteredTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Amount to Pay</span>
                <span className="font-semibold text-gray-800">{formatCurrency(finalAmount)}</span>
              </div>
              <div className="flex flex-col gap-1 border-t border-gray-200 pt-1 mt-1">
                {changeAmount > EPS && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Change</span>
                    <span className="font-semibold text-green-700">{formatCurrency(changeAmount)}</span>
                  </div>
                )}
                {remainingAfterEntries > EPS && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Remaining</span>
                    <span className="font-semibold text-red-600">{formatCurrency(remainingAfterEntries)}</span>
                  </div>
                )}
              </div>
            </div>

            {parkError && <p className="text-xs text-red-600 mt-2">{parkError}</p>}

            <div className="flex gap-3 mt-3">
              <Button
                type="button"
                variant="warning"
                className="flex-1"
                disabled={parking}
                onClick={handleParkFromModal}
              >
                {parking ? 'Parking...' : 'Park Transaction'}
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={confirmDisabled}
                onClick={() => setShowConfirmation(true)}
              >
                Confirm Payment
              </Button>
            </div>
          </div>
        </div>
      </FullScreenModal>

      <PaymentConfirmationModal
        open={showConfirmation}
        transaction={transaction}
        customer={customer}
        displayItems={displayItems}
        entries={entries}
        totalDue={totalDue}
        balanceSettled={balanceSettled}
        creditApplied={creditApplied}
        finalAmount={finalAmount}
        onBack={() => setShowConfirmation(false)}
        onDone={handleConfirmationDone}
      />

      <Modal open={closeGuard} onClose={() => setCloseGuard(false)} title="Cancel Payment?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Cancel payment? The transaction will remain in your queue.</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" className="flex-1" onClick={confirmClose}>
              Yes, Cancel
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setCloseGuard(false)}>
              Keep Going
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
