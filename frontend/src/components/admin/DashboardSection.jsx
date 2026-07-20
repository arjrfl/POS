import { usePaymentQueue, useReleasingQueue } from '../../hooks/useQueue'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { TopProductsChart } from './TopProductsChart'
import { formatCurrency } from '../../utils/format'

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

      <TopProductsChart />
    </div>
  )
}
