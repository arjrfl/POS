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
const DRAFT_AUTOSAVE_INTERVAL_MS = 120000

// Best-effort only: the ledger doesn't pre-reconcile which specific past
// entries still make up the current net_balance (a partial settlement
// doesn't record which original debit(s) it paid down). This walks the most
// recent entries of the given type and accepts them as "the source" only if
// they sum to the target within a cent — if that doesn't cleanly reconcile
// (e.g. because of an intervening partial settlement), the caller falls back
// to a plain, reference-free message rather than risk showing wrong sources.
function findLedgerSources(ledgerEntries, entryType, targetAmount) {
  if (!ledgerEntries?.length || targetAmount <= 0) return null

  const relevant = [...ledgerEntries]
    .filter((e) => e.entry_type === entryType)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const collected = []
  let sum = 0
  for (const entry of relevant) {
    if (sum >= targetAmount - EPS) break
    collected.push(entry)
    sum += Number(entry.amount)
  }

  return Math.abs(sum - targetAmount) <= 0.01 ? collected : null
}

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
  const [confirmMode, setConfirmMode] = useState('full')
  const [parking, setParking] = useState(false)
  const [parkError, setParkError] = useState('')

  const [collectBalance, setCollectBalance] = useState(false)
  const [balanceAmount, setBalanceAmount] = useState('')
  const [applyCredit, setApplyCredit] = useState(false)
  const [creditAmount, setCreditAmount] = useState('')

  // Fresh form every time the modal opens — no leftover entries from a
  // previously cancelled attempt on this same transaction. Entries themselves
  // are seeded separately below, from any saved drafts. Balance/credit
  // checkbox state is restored from the draft here too (parked with the
  // checkbox checked) — falls back to unchecked when there's nothing saved.
  // Deliberately depends only on [open], not `transaction` — same reasoning
  // as the entries-seed effect below: an incidental refetch while the modal
  // is already open shouldn't clobber the user's in-progress edits.
  useEffect(() => {
    if (open) {
      setMethodId('')
      setRefNumber('')
      setAmount('')
      setCloseGuard(false)
      setShowConfirmation(false)
      setConfirmMode('full')
      setParking(false)
      setParkError('')

      const draftBalance = Number(transaction.draft_balance_settled) || 0
      const draftCredit = Number(transaction.draft_credit_applied) || 0
      setCollectBalance(draftBalance > 0)
      setBalanceAmount(draftBalance > 0 ? String(draftBalance) : '')
      setApplyCredit(draftCredit > 0)
      setCreditAmount(draftCredit > 0 ? String(draftCredit) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Background auto-save every 2min while the modal is open — silent, no
  // toast/loading state. Refs keep the interval itself stable (created once
  // per modal-open) so adding/removing entries doesn't reset the cadence;
  // skipped while there's nothing to save or while the confirmation modal is
  // up (about to submit for real — an autosave landing mid-confirm would just
  // race the actual /pay call for no benefit).
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const showConfirmationRef = useRef(showConfirmation)
  useEffect(() => {
    showConfirmationRef.current = showConfirmation
  }, [showConfirmation])

  // balanceSettled/creditApplied themselves are derived values computed in
  // the render body below (after the early `if (!open) return null`, so they
  // can't be tracked with a hook there) — these refs mirror the raw checkbox
  // state instead, and the interval callback re-derives the same way.
  const collectBalanceRef = useRef(collectBalance)
  const balanceAmountRef = useRef(balanceAmount)
  const applyCreditRef = useRef(applyCredit)
  const creditAmountRef = useRef(creditAmount)
  useEffect(() => {
    collectBalanceRef.current = collectBalance
    balanceAmountRef.current = balanceAmount
    applyCreditRef.current = applyCredit
    creditAmountRef.current = creditAmount
  }, [collectBalance, balanceAmount, applyCredit, creditAmount])

  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => {
      if (entriesRef.current.length > 0 && !showConfirmationRef.current) {
        put(`/transactions/${transaction.id}/payment-drafts`, {
          entries: entriesRef.current.map((e) => ({
            payment_method_id: e.payment_method_id,
            amount: e.amount,
            tendered_amount: e.tendered_amount,
            ref_number: e.ref_number,
          })),
          balance_settled: collectBalanceRef.current ? Number(balanceAmountRef.current) || 0 : 0,
          credit_applied: applyCreditRef.current ? Number(creditAmountRef.current) || 0 : 0,
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

  const isFullyCovered = remainingAfterEntries <= EPS
  // matches the backend's process_payment rule: only original orders and
  // substandard-kilo adjustment children can be paid off partially, and only
  // when this payment isn't also collecting an old balance — mixing "new
  // utang from underpayment" with "old utang being paid off" in the same
  // transaction doesn't make sense. Credit applied does NOT block partial —
  // it just lowers the finalAmount target the entries need to cover.
  const balanceBeingCollectedThisPayment = balanceSettled > 0
  const partialEligible =
    (transaction.transaction_type === 'original' || transaction.transaction_type === 'adjustment') &&
    !balanceBeingCollectedThisPayment

  const structuralValid =
    entries.length > 0 &&
    !entries.some((e) => e.method_name !== 'cash' && !e.ref_number) &&
    cashEntryCount <= 1 &&
    balanceValid &&
    creditValid

  const confirmDisabled = !structuralValid || !isFullyCovered
  const partialConfirmDisabled = !structuralValid || enteredTotal < 1

  const openConfirmation = (mode) => {
    setConfirmMode(mode)
    setShowConfirmation(true)
  }

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
        balance_settled: balanceSettled,
        credit_applied: creditApplied,
      })
      await post(`/transactions/${transaction.id}/park`)
      onParked()
    } catch (err) {
      setParkError(err.message)
      setParking(false)
    }
  }

  const balanceSources = collectBalance
    ? findLedgerSources(customer?.ledger_entries, 'balance_added', absBalance)
    : null
  const creditSources = applyCredit
    ? findLedgerSources(customer?.ledger_entries, 'credit_added', netBalance)
    : null

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
                    <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-red-700">Outstanding Balance</span>
                        <span className="font-bold text-red-600">{formatCurrency(absBalance)}</span>
                      </div>
                      <label className="flex items-center gap-1.5 mt-1 text-red-700">
                        <input
                          type="checkbox"
                          className="accent-green-800"
                          checked={collectBalance}
                          onChange={(e) => handleToggleCollectBalance(e.target.checked)}
                        />
                        Collect with this payment
                      </label>
                      {collectBalance && (
                        <>
                          <Input
                            id="balance-amount"
                            type="number"
                            step="0.01"
                            value={balanceAmount}
                            onChange={(e) => setBalanceAmount(e.target.value)}
                            className="mt-1 text-xs"
                          />
                          {!balanceValid && <p className="text-red-600 mt-1">Cannot exceed outstanding balance</p>}
                          <div className="mt-2 pt-2 border-t border-red-200">
                            <span className="text-gray-500">From:</span>
                            {balanceSources ? (
                              <>
                                {balanceSources.slice(0, 3).map((s) => (
                                  <div key={s.id} className="flex justify-between text-gray-600">
                                    <span>&bull; {s.order_number}</span>
                                    <span>{formatCurrency(Number(s.amount))}</span>
                                  </div>
                                ))}
                                {balanceSources.length > 3 && (
                                  <div className="text-gray-500">+ {balanceSources.length - 3} more</div>
                                )}
                              </>
                            ) : (
                              <div className="text-gray-500">Balance of {formatCurrency(absBalance)} on account</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {netBalance > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-green-700">Available Credit</span>
                        <span className="font-bold text-green-600">{formatCurrency(netBalance)}</span>
                      </div>
                      <label className="flex items-center gap-1.5 mt-1 text-green-700">
                        <input
                          type="checkbox"
                          className="accent-green-800"
                          checked={applyCredit}
                          onChange={(e) => handleToggleApplyCredit(e.target.checked)}
                        />
                        Apply to this payment
                      </label>
                      {applyCredit && (
                        <>
                          <Input
                            id="credit-amount"
                            type="number"
                            step="0.01"
                            value={creditAmount}
                            onChange={(e) => setCreditAmount(e.target.value)}
                            className="mt-1 text-xs"
                          />
                          {!creditValid && (
                            <p className="text-red-600 mt-1">Cannot exceed available credit or order total</p>
                          )}
                          <div className="mt-2 pt-2 border-t border-green-200">
                            <span className="text-gray-500">From:</span>
                            {creditSources ? (
                              <>
                                {creditSources.slice(0, 3).map((s) => (
                                  <div key={s.id} className="flex justify-between text-gray-600">
                                    <span>&bull; {s.order_number}</span>
                                    <span>{formatCurrency(Number(s.amount))}</span>
                                  </div>
                                ))}
                                {creditSources.length > 3 && (
                                  <div className="text-gray-500">+ {creditSources.length - 3} more</div>
                                )}
                              </>
                            ) : (
                              <div className="text-gray-500">Credit of {formatCurrency(netBalance)} on account</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {netBalance === 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-md p-2 text-xs text-gray-400">
                      No outstanding balance or credit
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
                {isFullyCovered && changeAmount > EPS && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Change</span>
                    <span className="font-semibold text-green-700">{formatCurrency(changeAmount)}</span>
                  </div>
                )}
                {!isFullyCovered && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Remaining</span>
                    <span className="font-semibold text-red-600">{formatCurrency(remainingAfterEntries)}</span>
                  </div>
                )}
              </div>
            </div>

            {!isFullyCovered && partialEligible && (
              <div className="mt-3 bg-yellow-50 border border-yellow-300 rounded-md p-2 text-xs text-yellow-800">
                <span className="font-semibold">&#9888; Partial Payment</span>
                <p className="mt-1">
                  {formatCurrency(remainingAfterEntries)} will be added to the customer&apos;s outstanding balance.
                </p>
              </div>
            )}

            {!isFullyCovered && !partialEligible && (
              <div className="mt-3 bg-red-50 border border-red-300 rounded-md p-2 text-xs text-red-800">
                <span className="font-semibold">&#10005; Full payment required</span>
                <p className="mt-1">
                  {isBalanceSettlement
                    ? 'Balance settlement transactions must be paid in full.'
                    : balanceBeingCollectedThisPayment
                      ? `Partial payment is not allowed when collecting a customer balance. Please collect the full amount of ${formatCurrency(finalAmount)}.`
                      : 'This transaction must be paid in full.'}
                </p>
              </div>
            )}

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

              {isFullyCovered ? (
                <Button type="button" className="flex-1" disabled={confirmDisabled} onClick={() => openConfirmation('full')}>
                  Confirm Payment
                </Button>
              ) : partialEligible ? (
                <>
                  <Button
                    type="button"
                    variant="amber"
                    className="flex-1"
                    disabled={partialConfirmDisabled}
                    onClick={() => openConfirmation('partial')}
                  >
                    Confirm Partial Payment
                  </Button>
                  <Button type="button" className="flex-1" disabled>
                    Confirm Full Payment
                  </Button>
                </>
              ) : (
                <Button type="button" className="flex-1" disabled>
                  {isBalanceSettlement ? 'Confirm Payment' : 'Confirm Full Payment'}
                </Button>
              )}
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
        isPartial={confirmMode === 'partial'}
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
