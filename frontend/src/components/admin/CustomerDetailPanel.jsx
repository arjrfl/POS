import { useState } from 'react'
import { useCustomer, useCustomerLedger } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { FullScreenModal } from '../ui/FullScreenModal'
import { formatCurrency } from '../../utils/format'
import { getDisplayStatus, isViewablePaymentStatus } from '../../utils/transactionStatus'
import { getTransactionTypeLabel } from '../../utils/transactionType'
import { TransactionDetailsModal } from './TransactionDetailsModal'

const LEDGER_TAB_CLASS = (isActive) =>
  `px-3 py-1.5 text-sm border-b-2 transition-colors ${
    isActive
      ? 'font-bold text-gray-900 bg-white border-primary'
      : 'font-medium text-gray-500 border-transparent hover:text-gray-700'
  }`

// balance_added/credit_added increase what's outstanding; balance_settled and
// credit_used/credit_auto_used pay it back down — netting each bucket gives the
// still-outstanding total per side (these two totals sum to customer.net_balance).
const ENTRY_SIGN = {
  balance_added: { bucket: 'balance', sign: 1 },
  balance_settled: { bucket: 'balance', sign: -1 },
  credit_added: { bucket: 'credit', sign: 1 },
  credit_used: { bucket: 'credit', sign: -1 },
  credit_auto_used: { bucket: 'credit', sign: -1 },
}

function computeLedgerTotals(ledgerEntries) {
  let totalBalance = 0
  let totalCredit = 0
  for (const entry of ledgerEntries) {
    const rule = ENTRY_SIGN[entry.entry_type]
    if (!rule) continue
    const signedAmount = Number(entry.amount) * rule.sign
    if (rule.bucket === 'balance') totalBalance += signedAmount
    else totalCredit += signedAmount
  }
  return { totalBalance, totalCredit }
}

// One row of the full Transaction History table inside the Customer Details
// modal — same column set/action as TransactionsSection's own TransactionRow,
// minus the Customer column (redundant here — already scoped to one customer).
function CustomerTransactionRow({ transaction, onViewDetails }) {
  const { status: paymentStatus, label: paymentStatusLabel } = getDisplayStatus(transaction)
  const isViewable = isViewablePaymentStatus(paymentStatus)

  return (
    <tr className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm font-medium text-gray-900 truncate">{transaction.order_number}</td>
      <td className="px-3 py-2 text-sm text-gray-600 text-center">{getTransactionTypeLabel(transaction.transaction_type)}</td>
      <td className="px-3 py-2 text-center">
        <Badge status={paymentStatus}>{paymentStatusLabel}</Badge>
      </td>
      <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(transaction.total_due)}</td>
      <td className="px-3 py-2 text-sm text-gray-500 text-center">{new Date(transaction.created_at).toLocaleString()}</td>
      <td className="px-3 py-2 text-center">
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1 text-xs"
          disabled={!isViewable}
          title={isViewable ? undefined : 'Available once payment is processed'}
          onClick={() => onViewDetails(transaction.id)}
        >
          View Details
        </Button>
      </td>
    </tr>
  )
}

export function CustomerDetailPanel({ customerId }) {
  const { data: customer, isLoading } = useCustomer(customerId)
  // includePaymentStatus so this card's Status column can show the same
  // derived label (getDisplayStatus) as the modal's Transaction History table
  // below, instead of the raw transaction_status enum value.
  const { data: transactions, isLoading: loadingTransactions } = useTransactions({
    customerId,
    pageSize: 20,
    includePaymentStatus: true,
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [ledgerTab, setLedgerTab] = useState('balance')
  const [viewingTransactionId, setViewingTransactionId] = useState(null)
  const { data: ledgerEntries, isLoading: loadingLedger } = useCustomerLedger(customerId, ledgerTab, detailsOpen)
  // Same GET /transactions?customer_id= query as the standing panel's own card above
  // (and the Admin Transaction History tab it's modeled on) — just a bigger page size
  // and gated on the modal being open, since this table isn't paginated.
  const { data: allTransactions, isLoading: loadingAllTransactions } = useTransactions({
    customerId,
    pageSize: 100,
    enabled: detailsOpen,
    includePaymentStatus: true,
  })

  if (isLoading) return <Card>Loading customer...</Card>
  if (!customer) return null

  const { totalBalance, totalCredit } = computeLedgerTotals(customer.ledger_entries)

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <Card className="shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              {customer.full_name}
              <Badge status={customer.customer_status} />
            </h2>
            <p className="text-sm text-gray-500">{customer.contact_number ?? 'No contact number'}</p>
            <p className="text-sm text-gray-500">{customer.address ?? 'No address on file'}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setDetailsOpen(true)}>
            View Details
          </Button>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-8">
          <div>
            <span className="block text-xs text-gray-500 uppercase tracking-wide">Total Balance</span>
            <span className={`font-semibold ${totalBalance > 0 ? 'text-red-600' : 'text-gray-500'}`}>
              {formatCurrency(totalBalance)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-gray-500 uppercase tracking-wide">Total Credit</span>
            <span className={`font-semibold ${totalCredit > 0 ? 'text-green-700' : 'text-gray-500'}`}>
              {formatCurrency(totalCredit)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 shrink-0">Transaction History</h3>
        {loadingTransactions && <p className="text-sm text-gray-500">Loading...</p>}
        {!loadingTransactions && transactions?.items.length === 0 && (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        )}
        {!loadingTransactions && transactions?.items.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="px-3 py-2">Order #</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total Due</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {transactions.items.map((t) => {
                  // Same derived label the modal's own Transaction History table
                  // (CustomerTransactionRow below) and the Admin Transaction
                  // History tab use — not the raw transaction_status enum.
                  const { status: paymentStatus, label: paymentStatusLabel } = getDisplayStatus(t)
                  return (
                    <tr key={t.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">{t.order_number}</td>
                      <td className="px-3 py-2">
                        <Badge status={paymentStatus}>{paymentStatusLabel}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(t.total_due)}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{new Date(t.created_at).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FullScreenModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Customer Details"
        closeLabel="‹ Back"
      >
        <div className="flex flex-col gap-4 h-full min-h-0">
          {/* Row 1 — Customer Details (50%) + Balance & Credit (50%), fixed height */}
          <div className="flex gap-4 h-[318px] shrink-0">
            <div className="flex-1 min-w-0 bg-gray-100 border border-gray-400 rounded-lg p-4 overflow-y-auto">
              <h3 className="font-bold text-gray-900 mb-3">Customer Details</h3>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-gray-500 font-normal">Name: </span>
                  <span className="text-gray-900 font-semibold">{customer.full_name}</span>
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Contact: </span>
                  <span className="text-gray-900 font-semibold">{customer.contact_number ?? '—'}</span>
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Address: </span>
                  <span className="text-gray-900 font-semibold">{customer.address ?? '—'}</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="text-gray-500 font-normal">Status:</span>
                  <Badge status={customer.customer_status} />
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Total Balance: </span>
                  <span className="text-gray-900 font-semibold">{formatCurrency(customer.total_balance)}</span>
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Total Credit: </span>
                  <span className="text-gray-900 font-semibold">{formatCurrency(customer.total_credit)}</span>
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Date Listed: </span>
                  <span className="text-gray-900 font-semibold">{new Date(customer.created_at).toLocaleString()}</span>
                </p>
                <p>
                  <span className="text-gray-500 font-normal">Listed By: </span>
                  <span className="text-gray-900 font-semibold">{customer.listed_by_name ?? '—'}</span>
                </p>
              </div>
            </div>

            <div className="flex-1 min-w-0 bg-gray-100 border border-gray-400 rounded-lg p-4 flex flex-col min-h-0">
              <h3 className="font-bold text-gray-900 mb-2 shrink-0">Balance & Credit</h3>
              <div className="flex gap-1 border-b border-gray-300 shrink-0">
                <button type="button" className={LEDGER_TAB_CLASS(ledgerTab === 'balance')} onClick={() => setLedgerTab('balance')}>
                  Balance
                </button>
                <button type="button" className={LEDGER_TAB_CLASS(ledgerTab === 'credit')} onClick={() => setLedgerTab('credit')}>
                  Credit
                </button>
              </div>
              <div className="flex-1 min-h-0 mt-2 flex flex-col">
                {loadingLedger && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-gray-500">Loading...</p>
                  </div>
                )}
                {!loadingLedger && ledgerEntries?.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-gray-500">
                      {ledgerTab === 'balance' ? 'No balance entries' : 'No credit entries'}
                    </p>
                  </div>
                )}
                {!loadingLedger && ledgerEntries?.length > 0 && (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <table className="w-full table-fixed">
                      <thead className="sticky top-0 z-10 bg-gray-100">
                        <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-300">
                          <th className="w-1/3 px-2 py-1.5">Order #</th>
                          <th className="w-1/3 px-2 py-1.5">Date</th>
                          <th className="w-1/3 px-2 py-1.5 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerEntries.map((entry) => (
                          <tr key={entry.ledger_entry_id} className="border-b border-gray-200 last:border-b-0">
                            <td className="px-2 py-1.5 text-sm text-gray-900 truncate">{entry.order_number}</td>
                            <td className="px-2 py-1.5 text-sm text-gray-600">{new Date(entry.created_at).toLocaleString()}</td>
                            <td
                              className={`px-2 py-1.5 text-sm text-right font-medium ${
                                ledgerTab === 'balance' ? 'text-red-700' : 'text-green-700'
                              }`}
                            >
                              {formatCurrency(entry.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2 — Transaction History, full width */}
          <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg p-4 flex flex-col">
            <h3 className="font-bold text-gray-900 mb-3 shrink-0">Transaction History</h3>
            {loadingAllTransactions && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-500">Loading...</p>
              </div>
            )}
            {!loadingAllTransactions && allTransactions?.items.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-500">No transactions found</p>
              </div>
            )}
            {!loadingAllTransactions && allTransactions?.items.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <table className="w-full table-fixed">
                  <thead className="sticky top-0 z-10 bg-gray-100">
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-300">
                      <th className="w-1/6 px-3 py-2">Order #</th>
                      <th className="w-1/6 px-3 py-2 text-center">Type</th>
                      <th className="w-1/6 px-3 py-2 text-center">Status</th>
                      <th className="w-1/6 px-3 py-2 text-right">Total Due</th>
                      <th className="w-1/6 px-3 py-2 text-center">Created</th>
                      <th className="w-1/6 px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTransactions.items.map((t) => (
                      <CustomerTransactionRow key={t.id} transaction={t} onViewDetails={setViewingTransactionId} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </FullScreenModal>

      {viewingTransactionId && (
        <TransactionDetailsModal
          transactionId={viewingTransactionId}
          onClose={() => setViewingTransactionId(null)}
          onNavigate={setViewingTransactionId}
        />
      )}
    </div>
  )
}
