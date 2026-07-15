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
import { get, post, put } from '../../services/api'

const EPS = 0.005
const DRAFT_AUTOSAVE_INTERVAL_MS = 120000

export function PaymentModal({ open, transaction, onClose, onPaid, onParked }) {
  const { data: methods } = usePaymentMethods()
  const { data: customer } = useCustomer(transaction.customer_id)
  const { data: products } = useProducts()

  // 'credit' is a real payment_method row (so applied credit gets its own
  // payment_detail row server-side), but it's system-generated only — never
  // manually selectable from the payment method dropdown.
  const creditMethodId = useMemo(() => methods?.find((m) => m.payment_method_name === 'credit')?.id, [methods])
  const selectableMethods = useMemo(() => (methods ?? []).filter((m) => m.payment_method_name !== 'credit'), [methods])

  const [methodId, setMethodId] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [entries, setEntries] = useState([])
  const [closeGuard, setCloseGuard] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [confirmMode, setConfirmMode] = useState('full')
  const [parking, setParking] = useState(false)
  const [parkError, setParkError] = useState('')

  const [balanceEntries, setBalanceEntries] = useState([])
  const [checkedBalances, setCheckedBalances] = useState({})
  const [creditEntries, setCreditEntries] = useState([])
  const [checkedCredits, setCheckedCredits] = useState({})

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

      const draftBalances = transaction.draft_balances_json ? JSON.parse(transaction.draft_balances_json) : []
      setCheckedBalances(Object.fromEntries(draftBalances.map((b) => [b.ledger_entry_id, true])))
      // Credit doesn't have a per-entry draft column (only the total is
      // persisted in draft_credit_applied) — restored below once creditEntries
      // has loaded, by best-effort matching against that saved total.
      setCheckedCredits({})
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
    // The credit draft row (if any) is restored separately via checkedCredits
    // above, from draft_credit_applied — it must not also show up as a manual
    // entry row here, or it'd be double-represented and removable by mistake.
    const drafts = (transaction.payment_drafts ?? []).filter((d) => d.payment_method_id !== creditMethodId)
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

  // Fetch the customer's outstanding balance AND credit entries once per modal
  // open, so each can be shown as its own checkbox instead of one lump-sum
  // amount. Deliberately NOT gated on the sign of customer.net_balance —
  // net_balance is a single netted column, so a customer can have outstanding
  // balance_added entries and outstanding credit_added entries at the same
  // time even though they net to one sign (e.g. an old ₱100 balance offset by
  // a ₱150 refund-credit nets to +₱50, but the ₱100 balance is still
  // individually unsettled and must still show up here).
  useEffect(() => {
    if (!open || !customer) {
      setBalanceEntries([])
      setCreditEntries([])
      return
    }
    get(`/customers/${transaction.customer_id}/balance-entries`)
      .then((result) => setBalanceEntries(result ?? []))
      .catch(() => setBalanceEntries([]))

    const draftCreditTarget = Number(transaction.draft_credit_applied) || 0
    const draftCreditSources = transaction.draft_credit_sources_json
      ? JSON.parse(transaction.draft_credit_sources_json)
      : null
    get(`/customers/${transaction.customer_id}/credit-entries`)
      .then((result) => {
        const list = result ?? []
        setCreditEntries(list)
        if (draftCreditSources?.length) {
          // Authoritative: draft_credit_sources_json records exactly which
          // ledger entries were consumed at save time, by id — no guessing.
          setCheckedCredits(Object.fromEntries(draftCreditSources.map((s) => [s.ledger_entry_id, true])))
        } else if (draftCreditTarget > EPS && list.length) {
          // Fallback for drafts saved before source tracking existed: greedily
          // re-check the oldest outstanding entries until their total matches
          // what was saved at park time.
          let remaining = draftCreditTarget
          const checked = {}
          for (const entry of list) {
            if (remaining <= EPS) break
            checked[entry.ledger_entry_id] = true
            remaining -= Number(entry.amount)
          }
          setCheckedCredits(checked)
        }
      })
      .catch(() => setCreditEntries([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer])

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

  // totalBalanceSettled/creditApplied themselves are derived values computed in
  // the render body below (after the early `if (!open) return null`, so they
  // can't be tracked with a hook there) — these refs mirror the raw checkbox
  // state instead, and the interval callback re-derives the same way.
  const checkedBalancesRef = useRef(checkedBalances)
  const balanceEntriesRef = useRef(balanceEntries)
  const checkedCreditsRef = useRef(checkedCredits)
  const creditEntriesRef = useRef(creditEntries)
  useEffect(() => {
    checkedBalancesRef.current = checkedBalances
    balanceEntriesRef.current = balanceEntries
    checkedCreditsRef.current = checkedCredits
    creditEntriesRef.current = creditEntries
  }, [checkedBalances, balanceEntries, checkedCredits, creditEntries])

  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => {
      if (entriesRef.current.length > 0 && !showConfirmationRef.current) {
        const selectedBalances = balanceEntriesRef.current.filter((e) => checkedBalancesRef.current[e.ledger_entry_id])
        const selectedBalanceTotal = selectedBalances.reduce((sum, e) => sum + Number(e.amount), 0)
        const selectedCredits = creditEntriesRef.current.filter((e) => checkedCreditsRef.current[e.ledger_entry_id])
        const rawSelectedCreditTotal = selectedCredits.reduce((sum, e) => sum + Number(e.amount), 0)
        // Same cap as the render-scope creditApplied below — keeps the
        // persisted draft consistent with what confirm/park would actually apply.
        const selectedCreditTotal = Math.min(rawSelectedCreditTotal, Number(transaction.total_due) + selectedBalanceTotal)
        put(`/transactions/${transaction.id}/payment-drafts`, {
          entries: entriesRef.current.map((e) => ({
            payment_method_id: e.payment_method_id,
            amount: e.amount,
            tendered_amount: e.tendered_amount,
            ref_number: e.ref_number,
          })),
          draft_balances_to_settle: selectedBalances.map((e) => ({
            source_transaction_id: e.transaction_id,
            ledger_entry_id: e.ledger_entry_id,
            amount: Number(e.amount),
          })),
          credit_applied: selectedCreditTotal,
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

  const balancesToSettle = balanceEntries
    .filter((e) => checkedBalances[e.ledger_entry_id])
    .map((e) => ({
      source_transaction_id: e.transaction_id,
      ledger_entry_id: e.ledger_entry_id,
      amount: Number(e.amount),
      order_number: e.order_number,
    }))
  const totalBalanceSettled = balancesToSettle.reduce((sum, b) => sum + b.amount, 0)
  const anyBalanceChecked = balancesToSettle.length > 0

  const creditsToApply = creditEntries
    .filter((e) => checkedCredits[e.ledger_entry_id])
    .map((e) => ({
      ledger_entry_id: e.ledger_entry_id,
      amount: Number(e.amount),
      order_number: e.order_number,
    }))
  const rawCreditChecked = creditsToApply.reduce((sum, c) => sum + c.amount, 0)
  const anyCreditChecked = creditsToApply.length > 0
  const totalDueBeforeCredit = totalDue + totalBalanceSettled
  // Checked entries can sum to more than what's actually owed — cap what's
  // applied to the transaction at the amount due instead of blocking the
  // payment; the unused portion stays as credit on the customer's account.
  const creditApplied = Math.min(rawCreditChecked, totalDueBeforeCredit)

  const finalAmount = totalDueBeforeCredit - creditApplied

  // Read-only Entry Table rows, one per source transaction the applied credit
  // was drawn from — creditsToApply is already oldest-first (creditEntries
  // comes from /credit-entries, FIFO-ordered), so capping it here to
  // creditApplied reproduces the same per-source amounts the backend records.
  const creditRows = []
  let creditRowsRemaining = creditApplied
  for (const c of creditsToApply) {
    if (creditRowsRemaining <= EPS) break
    const rowAmount = Math.min(c.amount, creditRowsRemaining)
    creditRows.push({ ledger_entry_id: c.ledger_entry_id, amount: rowAmount, order_number: c.order_number })
    creditRowsRemaining -= rowAmount
  }

  const handleToggleBalanceEntry = (ledgerEntryId) => {
    setCheckedBalances((prev) => ({ ...prev, [ledgerEntryId]: !prev[ledgerEntryId] }))
  }

  const handleToggleCreditEntry = (ledgerEntryId) => {
    setCheckedCredits((prev) => ({ ...prev, [ledgerEntryId]: !prev[ledgerEntryId] }))
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
  const partialEligible =
    (transaction.transaction_type === 'original' || transaction.transaction_type === 'adjustment') &&
    !anyBalanceChecked

  // A manual cash/online entry isn't the only way to have "paid" — credit
  // fully covering the total (no cash/online needed at all) counts too.
  const hasPayment = entries.length > 0 || creditApplied > EPS

  const structuralValid =
    hasPayment &&
    !entries.some((e) => e.method_name !== 'cash' && !e.ref_number) &&
    cashEntryCount <= 1

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
        draft_balances_to_settle: balancesToSettle.map((b) => ({
          source_transaction_id: b.source_transaction_id,
          ledger_entry_id: b.ledger_entry_id,
          amount: b.amount,
        })),
        credit_applied: creditApplied,
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
        <div className="h-[80vh] flex flex-col min-h-0 max-w-6xl mx-auto">
        <div className="flex-1 min-h-0 flex flex-col bg-gray-100 border border-gray-400 rounded-lg p-4">
          <div className="flex-1 min-h-0 flex flex-row gap-4 overflow-hidden">
            <div className="flex-[21] min-w-0 h-full flex flex-col">
              <span className="text-sm font-semibold text-gray-600 mb-2">BALANCE / CREDIT</span>
              <div className="flex-1 min-h-0 overflow-y-auto border border-gray-300 rounded-lg p-3 flex flex-col gap-2">
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
                    {balanceEntries.length === 0 && creditEntries.length === 0 && (
                      <div className="bg-gray-50 border border-gray-200 rounded-md p-2 text-xs text-gray-400">
                        No outstanding balance or credit
                      </div>
                    )}
                    {balanceEntries.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-2">
                        <div className="flex justify-between text-xs font-semibold text-red-700">
                          <span>Balance</span>
                          <span>Total: {formatCurrency(balanceEntries.reduce((sum, e) => sum + Number(e.amount), 0))}</span>
                        </div>
                        {balanceEntries.map((entry) => (
                          <label key={entry.ledger_entry_id} className="flex items-center gap-2 py-1">
                            <input
                              type="checkbox"
                              className="accent-green-800"
                              checked={!!checkedBalances[entry.ledger_entry_id]}
                              onChange={() => handleToggleBalanceEntry(entry.ledger_entry_id)}
                            />
                            <span className="text-xs font-mono text-gray-700">{entry.order_number}</span>
                            <span className="text-xs font-bold text-red-600 ml-auto">
                              {formatCurrency(Number(entry.amount))}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(entry.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </label>
                        ))}
                        {anyBalanceChecked && (
                          <div className="text-xs text-red-700 font-semibold mt-1">
                            Settling: {formatCurrency(totalBalanceSettled)}
                          </div>
                        )}
                      </div>
                    )}
                    {creditEntries.length > 0 && (
                      <div className="bg-green-50 border border-green-200 rounded-md p-2">
                        <div className="flex justify-between text-xs font-semibold text-green-700">
                          <span>Credit</span>
                          <span>Total: {formatCurrency(creditEntries.reduce((sum, e) => sum + Number(e.amount), 0))}</span>
                        </div>
                        {creditEntries.map((entry) => (
                          <label key={entry.ledger_entry_id} className="flex items-center gap-2 py-1">
                            <input
                              type="checkbox"
                              className="accent-green-800"
                              checked={!!checkedCredits[entry.ledger_entry_id]}
                              onChange={() => handleToggleCreditEntry(entry.ledger_entry_id)}
                            />
                            <span className="text-xs font-mono text-gray-700">{entry.order_number}</span>
                            <span className="text-xs font-bold text-green-700 ml-auto">
                              {formatCurrency(Number(entry.amount))}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(entry.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </label>
                        ))}
                        {anyCreditChecked && (
                          <div className="text-xs text-green-700 font-semibold mt-1">
                            Applying: {formatCurrency(creditApplied)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex-[21] min-w-0 h-full flex flex-col">
              <span className="text-sm font-semibold text-gray-600 mb-2">REVISED TOTAL</span>
              <div className="flex-1 min-h-0 overflow-y-auto border border-gray-300 rounded-lg p-3 flex flex-col gap-1 text-sm">
                {!isBalanceSettlement && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Original Total</span>
                    <span className="text-gray-900">{formatCurrency(totalDue)}</span>
                  </div>
                )}
                {!isBalanceSettlement && totalBalanceSettled > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Balance Collected</span>
                    <span>+{formatCurrency(totalBalanceSettled)}</span>
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

            <div className="flex-[21] min-w-0 h-full flex flex-col">
              <span className="text-sm font-semibold text-gray-600 mb-2">PAYMENT ENTRY</span>
              <div className="flex-1 min-h-0 overflow-y-auto border border-gray-300 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="payment-method" className="text-sm font-medium text-gray-700">
                    Payment Method
                  </label>
                  <select
                    id="payment-method"
                    value={methodId}
                    onChange={(e) => setMethodId(e.target.value)}
                    disabled={isFullyCovered}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    {selectableMethods.map((m) => (
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
                  disabled={isCash || isFullyCovered}
                  className="disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                />

                <Input
                  id="entry-amount"
                  label="Amount for this entry"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isFullyCovered}
                  className="disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                />
                {isFullyCovered ? (
                  <div className="text-xs text-gray-400">Amount fully covered</div>
                ) : (
                  <div className={`text-sm font-semibold ${previewClass}`}>{previewLabel}</div>
                )}

                <Button type="button" variant="outline" disabled={addDisabled} onClick={handleAddEntry}>
                  + Add Payment Entry
                </Button>
              </div>
            </div>

            <div className="flex-[34] min-w-0 h-full flex flex-col">
              <span className="text-sm font-semibold text-gray-600 mb-2">ENTRY TABLE</span>
              <div className="flex-1 min-h-0 overflow-y-auto border border-gray-300 rounded-lg p-3">
                {entries.length === 0 && creditRows.length === 0 ? (
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
                      {creditRows.map((row) => (
                        <tr key={`credit-${row.ledger_entry_id}`} className="border-b border-gray-100 last:border-b-0">
                          <td className="py-2 pr-2 text-gray-900">Credit</td>
                          <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(row.amount)}</td>
                          <td className="py-2 pr-2 text-gray-700">{row.order_number}</td>
                          <td className="py-2 pl-1"></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-gray-200 pt-3 mt-3">
            {!isFullyCovered && partialEligible && (
              <div className="mb-3 bg-yellow-50 border border-yellow-300 rounded-md p-2 text-xs text-yellow-800">
                <span className="font-semibold">&#9888; Partial Payment</span>
                <p className="mt-1">
                  {formatCurrency(remainingAfterEntries)} will be added to the customer&apos;s outstanding balance.
                </p>
              </div>
            )}

            {!isFullyCovered && !partialEligible && (
              <div className="mb-3 bg-red-50 border border-red-300 rounded-md p-2 text-xs text-red-800">
                <span className="font-semibold">&#10005; Full payment required</span>
                <p className="mt-1">
                  {isBalanceSettlement
                    ? 'Balance settlement transactions must be paid in full.'
                    : anyBalanceChecked
                      ? `Partial payment is not allowed when collecting a customer balance. Please collect the full amount of ${formatCurrency(finalAmount)}.`
                      : 'This transaction must be paid in full.'}
                </p>
              </div>
            )}

            {parkError && <p className="text-xs text-red-600 mb-2">{parkError}</p>}

            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1 text-sm min-w-[200px]">
                {creditApplied > EPS && (
                  <div className="flex justify-between gap-6">
                    <span className="text-gray-700">
                      Credit <span className="text-xs text-gray-400">— Ref: {transaction.order_number}</span>
                    </span>
                    <span className="font-semibold text-green-700">{formatCurrency(creditApplied)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-6">
                  <span className="text-gray-700">Total Entered</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(enteredTotal + creditApplied)}</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-gray-600">Amount to Pay</span>
                  <span className="font-semibold text-gray-800">{formatCurrency(finalAmount + creditApplied)}</span>
                </div>
                <div className="flex flex-col gap-1 border-t border-gray-200 pt-1 mt-1">
                  {isFullyCovered && changeAmount > EPS && (
                    <div className="flex justify-between gap-6">
                      <span className="text-gray-700">Change</span>
                      <span className="font-semibold text-green-700">{formatCurrency(changeAmount)}</span>
                    </div>
                  )}
                  {!isFullyCovered && (
                    <div className="flex justify-between gap-6">
                      <span className="text-gray-700">Remaining</span>
                      <span className="font-semibold text-red-600">{formatCurrency(remainingAfterEntries)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 flex-wrap justify-end">
                <Button type="button" variant="warning" disabled={parking} onClick={handleParkFromModal}>
                  {parking ? 'Parking...' : 'Park Transaction'}
                </Button>

                {isFullyCovered ? (
                  <Button type="button" disabled={confirmDisabled} onClick={() => openConfirmation('full')}>
                    Confirm Payment
                  </Button>
                ) : partialEligible ? (
                  <>
                    <Button
                      type="button"
                      variant="amber"
                      disabled={partialConfirmDisabled}
                      onClick={() => openConfirmation('partial')}
                    >
                      Confirm Partial Payment
                    </Button>
                    <Button type="button" disabled>
                      Confirm Full Payment
                    </Button>
                  </>
                ) : (
                  <Button type="button" disabled>
                    {isBalanceSettlement ? 'Confirm Payment' : 'Confirm Full Payment'}
                  </Button>
                )}
              </div>
            </div>
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
        balancesToSettle={balancesToSettle}
        totalBalanceSettled={totalBalanceSettled}
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
