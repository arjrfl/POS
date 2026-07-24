import { useEffect, useState } from 'react'
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
const FILTER_STATE_KEY = 'admin_dashboard_filter_state'
const MASKED_VALUE = '••••••'

// { type: 'today' | 'all' | 'manual', from?, to? } | null. 'all' stores from/to
// for reference only — its from/to are always recomputed fresh on mount rather
// than trusted from a previous day (see the mount effect below).
function readStoredFilterState() {
  try {
    const raw = localStorage.getItem(FILTER_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function formatRangeLabel(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  const fromLabel = from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const toLabel = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fromLabel} – ${toLabel}`
}

function getTodayIso() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  // { from, to } | null. A persisted "manual" filter is restored synchronously
  // here (no network round-trip needed) so there's no default-Today flash on
  // reload; a persisted "all" filter can't be — its range depends on a fresh
  // server computation — so that one is restored by the mount effect below.
  const [appliedRange, setAppliedRange] = useState(() => {
    const stored = readStoredFilterState()
    if (stored?.type === 'manual' && stored.from && stored.to) {
      return { from: stored.from, to: stored.to }
    }
    return null
  })
  // Which preset (if any) produced the currently active appliedRange — lets the
  // modal tell "All was applied" apart from "the user happened to type the same
  // dates manually" when it reopens. 'today' never needs to be stored here: Run
  // with the Today preset sets appliedRange back to null, which is already the
  // same "default" state as never having filtered at all.
  const [appliedPreset, setAppliedPreset] = useState(null) // 'all' | null
  const [isAllTimeLoading, setAllTimeLoading] = useState(false)
  // Staged inside the currently-open modal only — separate from appliedRange/
  // appliedPreset above, which stay untouched until Run is clicked.
  const [stagedPreset, setStagedPreset] = useState(null) // 'today' | 'all' | null

  // Restores a persisted "all" filter on mount — its from/to are always
  // recomputed fresh (today's actual current date, not a stale reload-day
  // value from a previous session) rather than trusted from localStorage.
  useEffect(() => {
    const stored = readStoredFilterState()
    if (stored?.type !== 'all') return
    ;(async () => {
      try {
        const summaryData = await get('/admin/dashboard/summary?all_time=true')
        const range = summaryData?.range_applied
        if (range) {
          setAppliedRange({ from: range.from, to: range.to })
          setAppliedPreset('all')
        }
      } catch {
        // Leave the default Today scope in place on failure.
      }
    })()
  }, [])

  const toggleValuesHidden = () => {
    setValuesHidden((prev) => {
      const next = !prev
      localStorage.setItem(VALUES_HIDDEN_KEY, String(next))
      return next
    })
  }

  const handleOpenFilterModal = () => {
    if (appliedRange === null) {
      setStagedPreset(null)
      setDraftFrom(getTodayIso())
      setDraftTo(getTodayIso())
    } else if (appliedPreset === 'all') {
      setStagedPreset('all')
      setDraftFrom(appliedRange.from)
      setDraftTo(appliedRange.to)
    } else {
      setStagedPreset(null)
      setDraftFrom(appliedRange.from)
      setDraftTo(appliedRange.to)
    }
    setFilterModalOpen(true)
  }

  const handleRunFilter = () => {
    if (stagedPreset === 'today') {
      // Equivalent to clearing any active filter — reverts to the default
      // Today scope (dot clears, card labels drop the date-range subtext).
      setAppliedRange(null)
      setAppliedPreset(null)
      localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({ type: 'today' }))
    } else if (stagedPreset === 'all') {
      setAppliedRange({ from: draftFrom, to: draftTo })
      setAppliedPreset('all')
      localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({ type: 'all', from: draftFrom, to: draftTo }))
    } else {
      setAppliedRange({ from: draftFrom, to: draftTo })
      setAppliedPreset(null)
      localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({ type: 'manual', from: draftFrom, to: draftTo }))
    }
    setFilterModalOpen(false)
  }

  // Resets the modal's own staged state only — does not touch whatever filter
  // is currently applied to the dashboard until Run is next clicked.
  const handleClearStaging = () => {
    setStagedPreset(null)
    setDraftFrom('')
    setDraftTo('')
  }

  const handleStageToday = () => {
    const today = getTodayIso()
    setStagedPreset('today')
    setDraftFrom(today)
    setDraftTo(today)
  }

  const handleStageAllTime = async () => {
    setAllTimeLoading(true)
    try {
      const [summaryData] = await Promise.all([
        get('/admin/dashboard/summary?all_time=true'),
        get('/admin/dashboard/payment-user-sales?all_time=true'),
      ])
      const range = summaryData?.range_applied
      if (range) {
        setStagedPreset('all')
        setDraftFrom(range.from)
        setDraftTo(range.to)
      }
    } finally {
      setAllTimeLoading(false)
    }
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
        <Button type="button" variant="primary" onClick={toggleValuesHidden}>
          {valuesHidden ? 'Show' : 'Hide'}
        </Button>
        <div className="relative">
          <Button type="button" variant="primary" onClick={handleOpenFilterModal}>
            Filter
          </Button>
          {appliedRange && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 ring-2 ring-white animate-pulse"
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
          label={isFiltered ? 'Total Unpaid Transaction' : 'Total Unpaid Transaction Today'}
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unpaid_balance ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
        <SummaryCard
          label={isFiltered ? 'Total Unused Credit' : 'Total Unused Credit Today'}
          value={loadingSummary ? '...' : formatCurrency(summary?.total_unused_credit ?? 0)}
          hidden={valuesHidden}
          subtext={rangeLabel}
        />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-full min-h-0 flex flex-col">
          <TopProductsChart />
        </div>
        <div className="h-full min-h-0 flex flex-col">
          <PaymentUserSalesTable
            fromDate={appliedRange?.from}
            toDate={appliedRange?.to}
            rangeLabel={rangeLabel}
            valuesHidden={valuesHidden}
          />
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
        onClearStaging={handleClearStaging}
        onToday={handleStageToday}
        onAll={handleStageAllTime}
        stagedPreset={stagedPreset}
        allLoading={isAllTimeLoading}
      />
    </div>
  )
}
