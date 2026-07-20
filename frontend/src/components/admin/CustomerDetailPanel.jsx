import { useState } from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { formatCurrency } from '../../utils/format'

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

export function CustomerDetailPanel({ customerId }) {
  const { data: customer, isLoading } = useCustomer(customerId)
  const { data: transactions, isLoading: loadingTransactions } = useTransactions({ customerId, pageSize: 20 })
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (isLoading) return <Card>Loading customer...</Card>
  if (!customer) return null

  const { totalBalance, totalCredit } = computeLedgerTotals(customer.ledger_entries)

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <Card className="shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{customer.full_name}</h2>
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
                {transactions.items.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-2 text-sm font-medium text-gray-900">{t.order_number}</td>
                    <td className="px-3 py-2">
                      <Badge status={t.transaction_status} />
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(t.total_due)}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Customer Details">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-400">Details coming soon</p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => setDetailsOpen(false)}>
            Back
          </Button>
        </div>
      </Modal>
    </div>
  )
}
