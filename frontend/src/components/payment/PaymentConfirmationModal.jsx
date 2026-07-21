import { useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from './ArticleRows'
import { OriginalTransactionLink } from './OriginalTransactionLink'
import { post } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_LABEL } from '../../utils/customerType'
import { PAYMENT_METHOD_LABEL } from '../../utils/paymentMethod'

const EPS = 0.005

export function PaymentConfirmationModal({
  open,
  transaction,
  customer,
  displayItems,
  entries,
  totalDue,
  balancesToSettle,
  totalBalanceSettled,
  creditApplied,
  creditEntriesChecked,
  finalAmount,
  isPartial,
  onBack,
  onDone,
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showAllBalances, setShowAllBalances] = useState(false)
  // 'ask' = Popup 1 (does the customer want to claim the change?)
  // 'confirm' = Popup 2 (confirm change becomes credit)
  const [changeStep, setChangeStep] = useState(null)
  const [pendingAction, setPendingAction] = useState(null) // 'print' | 'done'

  if (!open) return null

  const isBalanceSettlement = transaction.transaction_type === 'balance_settlement'
  const isAdjustment = transaction.transaction_type === 'adjustment'
  const isRefund = transaction.transaction_type === 'refund'
  const isAdjustmentChild = isAdjustment || isRefund
  const enteredTotal = entries.reduce((sum, e) => sum + e.amount, 0)
  const changeTotal = Math.max(enteredTotal - finalAmount, 0)
  const remaining = Math.max(finalAmount - enteredTotal, 0)

  // Entries store exactly what the cashier typed (so the UI can show a cash
  // overpayment verbatim), but for a full payment the backend requires
  // sum(amount) === finalAmount exactly. Online entries are never allowed to
  // exceed what's remaining, so only the single cash entry (if any) needs its
  // submitted amount reduced to the actual credited portion — tendered_amount
  // still carries the full typed figure so the backend computes the same
  // change shown here. A partial payment is an underpayment by definition, so
  // no capping is needed there — entries are submitted exactly as entered.
  const onlineTotal = entries.filter((e) => e.method_name !== 'cash').reduce((sum, e) => sum + e.amount, 0)
  const creditedCashAmount = Math.round((finalAmount - onlineTotal) * 100) / 100

  const submitPayment = (changeClaimed) => {
    const payments = entries.map((e) => ({
      payment_method_id: e.payment_method_id,
      amount: !isPartial && e.method_name === 'cash' ? creditedCashAmount : e.amount,
      tendered_amount: e.tendered_amount,
      ref_number: e.ref_number,
    }))
    // Derived from the same `payments` array being submitted (post cash-cap),
    // not from the raw entered total — a cash overpayment legitimately makes
    // those two differ (entered 1200, credited 1160, 40 change), and the
    // backend requires amount_paid to equal sum(payments) exactly.
    const amountPaid = payments.reduce((sum, p) => sum + p.amount, 0)

    return post(`/transactions/${transaction.id}/pay`, {
      payments,
      credit_entries_checked: creditEntriesChecked,
      balances_to_settle: balancesToSettle.map((b) => ({
        source_transaction_id: b.source_transaction_id,
        ledger_entry_id: b.ledger_entry_id,
        amount: b.amount,
      })),
      is_partial: isPartial,
      amount_paid: amountPaid,
      change_claimed: changeClaimed,
    })
  }

  // Actually submits the payment (after the change-claim popups, if any, have
  // been resolved) and performs the print/done follow-up action.
  const finalizePayment = async (action, changeClaimed) => {
    // belt-and-suspenders alongside disabled={submitting} on the buttons —
    // disabled only takes effect on the next render, this closes that gap
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      const paid = await submitPayment(changeClaimed)
      if (action === 'print') window.print()
      onDone(paid)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  // changeTotal is only ever >0 for a full (non-partial) payment — a partial
  // payment is an underpayment by definition, so this popup gate never
  // triggers there, but the check applies unconditionally rather than
  // special-casing isPartial.
  const startConfirm = (action) => {
    if (submitting) return
    if (changeTotal > EPS) {
      setPendingAction(action)
      setChangeStep('ask')
      return
    }
    void finalizePayment(action, true)
  }

  const handleConfirmAndPrint = () => startConfirm('print')
  const handleConfirmAndDone = () => startConfirm('done')

  const handleClaimYes = () => {
    setChangeStep(null)
    void finalizePayment(pendingAction, true)
  }
  const handleClaimNo = () => setChangeStep('confirm')
  const handleCreditConfirm = () => {
    setChangeStep(null)
    void finalizePayment(pendingAction, false)
  }
  const handleCreditCancel = () => setChangeStep('ask')

  return (
    <>
    <FullScreenModal open={open} onClose={onBack} title="Confirm Payment">
      <div className="max-w-6xl mx-auto h-[85vh] flex flex-col min-h-0">
        <button
          type="button"
          onClick={onBack}
          className="flex-shrink-0 self-start text-sm text-primary hover:underline mb-3"
        >
          &larr; Back
        </button>

        <div className="print-receipt flex-1 min-h-0 flex flex-row gap-4 overflow-hidden">
          <div className="w-3/5 min-h-0 flex flex-col gap-3 bg-gray-100 border border-gray-400 rounded-lg p-3">
          <div className="flex-shrink-0">
            {isAdjustmentChild && (
              <div className="flex flex-col gap-1 pb-2 mb-2 border-b border-gray-200">
                <span
                  className={`inline-flex items-center self-start px-2 py-0.5 rounded-full text-xs font-bold ${
                    isRefund ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {isRefund ? 'REFUND' : 'ADJUSTMENT'}
                </span>
                <div className="text-xs text-gray-500">
                  <OriginalTransactionLink transaction={transaction} />
                </div>
              </div>
            )}
            <div className="font-semibold text-gray-900">{customer?.full_name}</div>
            {customer?.address && <div className="text-sm text-gray-500">{customer.address}</div>}
            {customer?.contact_number && <div className="text-sm text-gray-500">{customer.contact_number}</div>}
            <div className="text-sm text-gray-700 mt-1">
              Customer Type: {CUSTOMER_TYPE_LABEL[transaction.customer_type]}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto border border-gray-300 rounded-md bg-white">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className={`py-2 pl-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[0]}`}>QTY</th>
                  <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[1]}`}>UNIT</th>
                  <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[2]}`}>ARTICLES</th>
                  <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[3]}`}>UNIT PRICE</th>
                  <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[4]}`}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {isAdjustmentChild ? (
                  <ArticleRows transaction={transaction} />
                ) : (
                  displayItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100 last:border-b-0 align-top">
                      <td className="py-2 pl-2 pr-2 text-gray-700">{item.quantity_kg.toFixed(3)}</td>
                      <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-900">{item.product_name}</div>
                        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                      </td>
                      <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                    </tr>
                  ))
                )}
                {(balancesToSettle.length > 0 || creditApplied > 0) && (
                  <tr>
                    <td colSpan={5} className="border-t-2 border-gray-300 py-1"></td>
                  </tr>
                )}
                {balancesToSettle.map((b) => (
                  <tr key={b.ledger_entry_id} className="border-b border-gray-100 last:border-b-0 align-top">
                    <td className="py-2 pl-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-gray-900">Balance Settlement</div>
                      <div className="text-xs text-gray-400">from {b.order_number}</div>
                    </td>
                    <td className="py-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2 font-medium text-red-600">{formatCurrency(b.amount)}</td>
                  </tr>
                ))}
                {creditApplied > 0 && (
                  <tr className="border-b border-gray-100 last:border-b-0 align-top">
                    <td className="py-2 pl-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-gray-900">Credit Applied</div>
                      <div className="text-xs text-gray-500">Account Credit</div>
                    </td>
                    <td className="py-2 pr-2 text-gray-400">&mdash;</td>
                    <td className="py-2 pr-2 font-medium text-green-700">-{formatCurrency(creditApplied)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </div>

          <div className="w-2/5 min-h-0 overflow-y-auto flex flex-col gap-3">
          <div className="p-3 border border-gray-200 rounded-md flex flex-col gap-1 text-sm">
            {isPartial ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-700">Original Total</span>
                  <span className="text-gray-900">{formatCurrency(totalDue)}</span>
                </div>
                <div className="flex justify-between text-green-700">
                  <span>Amount Paid</span>
                  <span className="font-semibold">{formatCurrency(enteredTotal)}</span>
                </div>
                <div className="border-t border-gray-200 pt-2 mt-1 flex justify-between items-center text-red-600 font-bold bg-red-50 rounded px-2 py-1">
                  <span>Remaining Balance</span>
                  <span>{formatCurrency(remaining)}</span>
                </div>
                <p className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-300 rounded-md p-2 mt-1">
                  &#9888; {formatCurrency(remaining)} will be recorded as outstanding balance on this account.
                </p>

                <div className="mt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment Breakdown</div>
                {entries.map((e) => (
                  <div key={e.id} className="flex justify-between text-gray-700">
                    <span>
                      {PAYMENT_METHOD_LABEL[e.method_name] ?? e.method_name}
                      {e.ref_number ? ` — Ref: ${e.ref_number}` : ''}
                    </span>
                    <span>{formatCurrency(e.amount)}</span>
                  </div>
                ))}

                {changeTotal > 0 && (
                  <div className="border-t border-gray-200 pt-2 mt-1 flex justify-between">
                    <span className="text-gray-700">Change</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(changeTotal)}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                {isBalanceSettlement ? (
                  <div className="flex justify-between text-red-600 font-medium">
                    <span>Balance Settlement</span>
                    <span>{formatCurrency(totalDue)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-700">Original Total</span>
                      <span className="text-gray-900">{formatCurrency(totalDue)}</span>
                    </div>
                    {balancesToSettle.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {balancesToSettle.length <= 2 ? (
                          balancesToSettle.map((b) => (
                            <div key={b.ledger_entry_id} className="flex justify-between text-red-600">
                              <span>{b.order_number}</span>
                              <span>+{formatCurrency(b.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="flex justify-between text-red-600">
                              <button
                                type="button"
                                onClick={() => setShowAllBalances((v) => !v)}
                                className="text-left hover:underline"
                              >
                                Balance Settlements ({balancesToSettle.length}) {showAllBalances ? '▲' : '▼'}
                              </button>
                              <span>+{formatCurrency(totalBalanceSettled)}</span>
                            </div>
                            {showAllBalances &&
                              balancesToSettle.map((b) => (
                                <div key={b.ledger_entry_id} className="flex justify-between text-red-600 pl-2 text-xs">
                                  <span>{b.order_number}</span>
                                  <span>+{formatCurrency(b.amount)}</span>
                                </div>
                              ))}
                          </>
                        )}
                      </div>
                    )}
                    {creditApplied > 0 && (
                      <div className="flex justify-between text-green-700">
                        <span>Credit Applied</span>
                        <span>-{formatCurrency(creditApplied)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="border-t border-gray-200 pt-2 mt-1 flex justify-between font-semibold text-gray-900">
                  <span>Amount to Collect</span>
                  <span>{formatCurrency(finalAmount)}</span>
                </div>

                <div className="mt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment Breakdown</div>
                {entries.map((e) => (
                  <div key={e.id} className="flex justify-between text-gray-700">
                    <span>
                      {PAYMENT_METHOD_LABEL[e.method_name] ?? e.method_name}
                      {e.ref_number ? ` — Ref: ${e.ref_number}` : ''}
                    </span>
                    <span>{formatCurrency(e.amount)}</span>
                  </div>
                ))}

                <div className="border-t border-gray-200 pt-2 mt-1 flex justify-between">
                  <span className="text-gray-700">Total Paid</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(enteredTotal)}</span>
                </div>
                {changeTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Change</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(changeTotal)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {isPartial && (
            <p className="flex-shrink-0 text-xs text-gray-600 text-center">
              Outstanding balance of {formatCurrency(remaining)} has been added to this customer&apos;s account.
            </p>
          )}
          </div>
        </div>

        {error && <p className="flex-shrink-0 text-sm text-red-600 mt-2">{error}</p>}

        <div className="flex-shrink-0 flex gap-2 mt-3">
          {isPartial ? (
            <>
              <Button type="button" variant="amber" className="flex-1" disabled={submitting} onClick={handleConfirmAndPrint}>
                {submitting ? 'Processing...' : 'Confirm Partial & Print'}
              </Button>
              <Button
                type="button"
                variant="warning"
                className="flex-1"
                disabled={submitting}
                onClick={handleConfirmAndDone}
              >
                Confirm Partial & Done
              </Button>
              <button
                type="button"
                onClick={onBack}
                disabled={submitting}
                className="flex-1 text-sm text-primary hover:underline disabled:opacity-50"
              >
                Back
              </button>
            </>
          ) : (
            <>
              <Button type="button" className="flex-1" disabled={submitting} onClick={handleConfirmAndPrint}>
                {submitting ? 'Processing...' : 'Confirm & Print Receipt'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={submitting}
                onClick={handleConfirmAndDone}
              >
                Confirm & Done
              </Button>
            </>
          )}
        </div>
      </div>
    </FullScreenModal>

    <Modal open={changeStep === 'ask'} onClose={() => setChangeStep(null)} title="Change">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-700">
          Change: <span className="font-semibold">{formatCurrency(changeTotal)}</span>
        </p>
        <p className="text-sm text-gray-700">Does the customer want to claim this change?</p>
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handleClaimYes}>
            Yes
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handleClaimNo}>
            No
          </Button>
        </div>
      </div>
    </Modal>

    <Modal open={changeStep === 'confirm'} onClose={handleCreditCancel} title="Add Change as Credit">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-700">
          Change: <span className="font-semibold">{formatCurrency(changeTotal)}</span> will be added to customer&apos;s
          credit
        </p>
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handleCreditConfirm}>
            Confirm
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handleCreditCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
