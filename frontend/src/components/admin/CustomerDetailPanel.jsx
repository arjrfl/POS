import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCurrency } from '../../utils/format'

const BALANCE_ENTRY_TYPES = ['balance_added', 'balance_settled']
const CREDIT_ENTRY_TYPES = ['credit_added', 'credit_used', 'credit_auto_used']

function NetBalance({ netBalance }) {
  const amount = Number(netBalance)
  if (amount > 0) return <span className="text-green-700 font-semibold">Credit: {formatCurrency(amount)}</span>
  if (amount < 0) return <span className="text-red-600 font-semibold">Balance: {formatCurrency(Math.abs(amount))}</span>
  return <span className="text-gray-500 font-semibold">₱0.00</span>
}

function LedgerPanel({ title, entries, emptyMessage }) {
  return (
    <Card className="flex flex-col h-72">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 shrink-0">{title}</h3>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">{emptyMessage}</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-2 text-sm text-gray-500">{new Date(entry.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(entry.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

export function CustomerDetailPanel({ customerId }) {
  const { data: customer, isLoading } = useCustomer(customerId)
  const { data: transactions, isLoading: loadingTransactions } = useTransactions({ customerId, pageSize: 20 })

  if (isLoading) return <Card>Loading customer...</Card>
  if (!customer) return null

  const sortedEntries = [...customer.ledger_entries].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  )
  const balanceEntries = sortedEntries.filter((entry) => BALANCE_ENTRY_TYPES.includes(entry.entry_type))
  const creditEntries = sortedEntries.filter((entry) => CREDIT_ENTRY_TYPES.includes(entry.entry_type))

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <Card className="shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{customer.full_name}</h2>
            <p className="text-sm text-gray-500">{customer.contact_number ?? 'No contact number'}</p>
            <p className="text-sm text-gray-500">{customer.address ?? 'No address on file'}</p>
          </div>
          <Badge status={customer.customer_status} />
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200">
          <NetBalance netBalance={customer.net_balance} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 shrink-0">
        <LedgerPanel title="Customer Balance" entries={balanceEntries} emptyMessage="No balance history" />
        <LedgerPanel title="Customer Credit" entries={creditEntries} emptyMessage="No credit history" />
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 shrink-0">Transaction History</h3>
        {loadingTransactions && <p className="text-sm text-gray-500">Loading...</p>}
        {!loadingTransactions && transactions?.items.length === 0 && (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        )}
        {!loadingTransactions && transactions?.items.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full">
              <thead>
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
    </div>
  )
}
