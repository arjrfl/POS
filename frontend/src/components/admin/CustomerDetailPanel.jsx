import { useCustomer } from '../../hooks/useCustomer'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCurrency } from '../../utils/format'

function NetBalance({ netBalance }) {
  const amount = Number(netBalance)
  if (amount > 0) return <span className="text-green-700 font-semibold">Credit: {formatCurrency(amount)}</span>
  if (amount < 0) return <span className="text-red-600 font-semibold">Balance: {formatCurrency(Math.abs(amount))}</span>
  return <span className="text-gray-500 font-semibold">₱0.00</span>
}

export function CustomerDetailPanel({ customerId }) {
  const { data: customer, isLoading } = useCustomer(customerId)
  const { data: transactions, isLoading: loadingTransactions } = useTransactions({ customerId, pageSize: 20 })

  if (isLoading) return <Card>Loading customer...</Card>
  if (!customer) return null

  return (
    <div className="flex flex-col gap-4">
      <Card>
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

      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Ledger History</h3>
        {customer.ledger_entries.length === 0 && <p className="text-sm text-gray-500">No ledger movements yet.</p>}
        {customer.ledger_entries.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Entry Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {customer.ledger_entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-2 text-sm text-gray-500">{new Date(entry.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 capitalize">{entry.entry_type.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(entry.amount)}</td>
                  <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(entry.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Transaction History</h3>
        {loadingTransactions && <p className="text-sm text-gray-500">Loading...</p>}
        {!loadingTransactions && transactions?.items.length === 0 && (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        )}
        {!loadingTransactions && transactions?.items.length > 0 && (
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
        )}
      </Card>
    </div>
  )
}
