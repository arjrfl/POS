import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTransactions } from '../../hooks/useTransactions'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { TopProductsChart } from './TopProductsChart'
import { PaymentUserSalesTable } from './PaymentUserSalesTable'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'

const VALUES_HIDDEN_KEY = 'admin_dashboard_values_hidden'
const MASKED_VALUE = '••••••'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function SummaryCard({ label, value, hidden }) {
  return (
    <Card>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{hidden ? MASKED_VALUE : value}</div>
    </Card>
  )
}

export function DashboardSection() {
  const today = todayIsoDate()
  const [valuesHidden, setValuesHidden] = useState(() => localStorage.getItem(VALUES_HIDDEN_KEY) === 'true')

  const toggleValuesHidden = () => {
    setValuesHidden((prev) => {
      const next = !prev
      localStorage.setItem(VALUES_HIDDEN_KEY, String(next))
      return next
    })
  }

  // page_size=100 (the API max) is enough for a single shop's daily volume;
  // .total below (the count stat) is always exact regardless, since it comes
  // from a separate COUNT query server-side, not items.length.
  const { data: completedToday, isLoading: loadingCompleted } = useTransactions({
    status: 'completed',
    dateFrom: today,
    dateTo: today,
    pageSize: 100,
  })
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['admin', 'dashboard', 'summary'],
    queryFn: () => get('/admin/dashboard/summary'),
  })

  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={toggleValuesHidden}>
          {valuesHidden ? 'Show' : 'Hide'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => console.log('Filter clicked - not yet wired')}
        >
          Filter
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Transactions Today"
          value={loadingCompleted ? '...' : (completedToday?.total ?? 0)}
          hidden={valuesHidden}
        />
        <SummaryCard
          label="Total Sales Today"
          value={loadingSummary ? '...' : formatCurrency(summary?.total_sales_today ?? 0)}
          hidden={valuesHidden}
        />
        <SummaryCard
          label="Actual Sales Today"
          value={loadingSummary ? '...' : formatCurrency(summary?.actual_sales_today ?? 0)}
          hidden={valuesHidden}
        />
        <SummaryCard
          label="Total Unpaid Transaction"
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unpaid_balance ?? 0)}
          hidden={valuesHidden}
        />
        <SummaryCard
          label="Total Unused Credit"
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unused_credit ?? 0)}
          hidden={valuesHidden}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="flex-[60] h-full min-h-0 flex flex-col">
          <TopProductsChart />
        </div>
        <div className="flex-[40] h-full min-h-0 flex flex-col">
          <PaymentUserSalesTable />
        </div>
      </div>
    </div>
  )
}
