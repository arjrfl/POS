import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { TopProductsChart } from './TopProductsChart'
import { PaymentUserSalesTable } from './PaymentUserSalesTable'
import { DashboardFilterModal } from './DashboardFilterModal'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { buildRangeQueryString } from '../../utils/dateRange'

const VALUES_HIDDEN_KEY = 'admin_dashboard_values_hidden'
const MASKED_VALUE = '••••••'

function formatRangeLabel(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  const fromLabel = from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const toLabel = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fromLabel} – ${toLabel}`
}

function SummaryCard({ label, value, hidden, subtext }) {
  return (
    <Card>
      <div className="text-sm text-gray-500">{label}</div>
      {subtext && <div className="text-xs text-gray-400 mt-0.5">{subtext}</div>}
      <div className="mt-1 text-2xl font-bold text-gray-900">{hidden ? MASKED_VALUE : value}</div>
    </Card>
  )
}

export function DashboardSection() {
  const [valuesHidden, setValuesHidden] = useState(() => localStorage.getItem(VALUES_HIDDEN_KEY) === 'true')
  const [isFilterModalOpen, setFilterModalOpen] = useState(false)
  // Draft fields persist across modal open/close so reopening after a filter
  // is applied shows the previously-selected range, not a blank form.
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const [appliedRange, setAppliedRange] = useState(null) // { from, to } | null — not persisted, resets on reload

  const toggleValuesHidden = () => {
    setValuesHidden((prev) => {
      const next = !prev
      localStorage.setItem(VALUES_HIDDEN_KEY, String(next))
      return next
    })
  }

  const handleRunFilter = () => {
    setAppliedRange({ from: draftFrom, to: draftTo })
    setFilterModalOpen(false)
  }

  const handleClearFilter = () => {
    setDraftFrom('')
    setDraftTo('')
    setAppliedRange(null)
    setFilterModalOpen(false)
  }

  const rangeQuery = buildRangeQueryString(appliedRange?.from, appliedRange?.to)

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['admin', 'dashboard', 'summary', appliedRange],
    queryFn: () => get(`/admin/dashboard/summary${rangeQuery}`),
  })

  const rangeLabel = appliedRange ? formatRangeLabel(appliedRange.from, appliedRange.to) : null
  const isFiltered = Boolean(appliedRange)

  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={toggleValuesHidden}>
          {valuesHidden ? 'Show' : 'Hide'}
        </Button>
        <div className="relative">
          <Button type="button" variant="outline" onClick={() => setFilterModalOpen(true)}>
            Filter
          </Button>
          {appliedRange && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label={isFiltered ? 'Transactions' : 'Transactions Today'}
          value={loadingSummary ? '...' : (summary?.transactions_today ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
        <SummaryCard
          label={isFiltered ? 'Total Sales' : 'Total Sales Today'}
          value={loadingSummary ? '...' : formatCurrency(summary?.total_sales_today ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
        <SummaryCard
          label={isFiltered ? 'Actual Sales' : 'Actual Sales Today'}
          value={loadingSummary ? '...' : formatCurrency(summary?.actual_sales_today ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
        <SummaryCard
          label="Total Unpaid Transaction"
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unpaid_balance ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
        <SummaryCard
          label="Total Unused Credit"
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unused_credit ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
        <div className="flex-[60] h-full min-h-0 flex flex-col">
          <TopProductsChart />
        </div>
        <div className="flex-[40] h-full min-h-0 flex flex-col">
          <PaymentUserSalesTable fromDate={appliedRange?.from} toDate={appliedRange?.to} rangeLabel={rangeLabel} />
        </div>
      </div>

      <DashboardFilterModal
        open={isFilterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        fromDate={draftFrom}
        toDate={draftTo}
        onChangeFrom={setDraftFrom}
        onChangeTo={setDraftTo}
        onRun={handleRunFilter}
        onClear={handleClearFilter}
      />
    </div>
  )
}
