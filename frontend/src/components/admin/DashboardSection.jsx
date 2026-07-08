import { useCustomer } from '../../hooks/useCustomer'
import { usePaymentQueue, useReleasingQueue } from '../../hooks/useQueue'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCurrency } from '../../utils/currency'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function SummaryCard({ label, value }) {
  return (
    <Card>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
    </Card>
  )
}

function RecentRow({ transaction }) {
  const { data: customer } = useCustomer(transaction.customer_id)
  return (
    <tr className="border-b border-gray-100 last:border-b-0">
      <td className="px-3 py-2 text-sm font-medium text-gray-900">{transaction.order_number}</td>
      <td className="px-3 py-2 text-sm text-gray-700">{customer?.full_name ?? '...'}</td>
      <td className="px-3 py-2 text-sm text-gray-600 capitalize">{transaction.customer_type.replace('_', ' ')}</td>
      <td className="px-3 py-2">
        <Badge status={transaction.transaction_status} />
      </td>
      <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(transaction.total_due)}</td>
      <td className="px-3 py-2 text-sm text-gray-500">{new Date(transaction.created_at).toLocaleString()}</td>
    </tr>
  )
}

export function DashboardSection() {
  const today = todayIsoDate()

  // page_size=100 (the API max) is enough for a single shop's daily volume;
  // .total below (the count stat) is always exact regardless, since it comes
  // from a separate COUNT query server-side, not items.length.
  const { data: completedToday, isLoading: loadingCompleted } = useTransactions({
    status: 'completed',
    dateFrom: today,
    dateTo: today,
    pageSize: 100,
  })
  const { data: paymentQueue, isLoading: loadingPayment } = usePaymentQueue()
  const { data: releasingQueue, isLoading: loadingReleasing } = useReleasingQueue()
  const { data: recent, isLoading: loadingRecent } = useTransactions({ pageSize: 20 })

  const totalSalesToday = (completedToday?.items ?? []).reduce(
    (sum, t) => sum + Number(t.actual_amount ?? t.estimated_amount ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Transactions Today" value={loadingCompleted ? '...' : (completedToday?.total ?? 0)} />
        <SummaryCard label="Total Sales Today" value={loadingCompleted ? '...' : formatCurrency(totalSalesToday)} />
        <SummaryCard label="Pending in Payment" value={loadingPayment ? '...' : (paymentQueue?.total ?? 0)} />
        <SummaryCard label="Pending in Releasing" value={loadingReleasing ? '...' : (releasingQueue?.total ?? 0)} />
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Transactions</h2>
        {loadingRecent && <p className="text-gray-500 text-sm">Loading...</p>}
        {!loadingRecent && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="px-3 py-2">Order #</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total Due</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {recent?.items.map((transaction) => (
                  <RecentRow key={transaction.id} transaction={transaction} />
                ))}
              </tbody>
            </table>
            {recent?.items.length === 0 && <p className="text-gray-500 text-sm py-4">No transactions yet.</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
