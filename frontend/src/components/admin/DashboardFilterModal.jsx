import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

export function DashboardFilterModal({
  open,
  onClose,
  fromDate,
  toDate,
  onChangeFrom,
  onChangeTo,
  onRun,
  onClearStaging,
  onToday,
  onAll,
  stagedPreset,
  allLoading,
}) {
  const fieldsDisabled = stagedPreset === 'today' || stagedPreset === 'all'
  const bothFilled = Boolean(fromDate) && Boolean(toDate)
  const isInvalidRange = bothFilled && fromDate > toDate
  const canRun = bothFilled && !isInvalidRange

  return (
    <Modal open={open} onClose={onClose} title="Filter Dashboard">
      <div className="flex flex-col gap-4">
        <Input
          id="dashboard-filter-from"
          label="From"
          type="date"
          value={fromDate}
          onChange={(e) => onChangeFrom(e.target.value)}
          disabled={fieldsDisabled}
          className={fieldsDisabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}
        />
        <Input
          id="dashboard-filter-to"
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => onChangeTo(e.target.value)}
          disabled={fieldsDisabled}
          className={fieldsDisabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}
        />

        {isInvalidRange && <p className="text-sm text-red-600">From date must be before or equal to To date</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="outline" onClick={onClearStaging}>
            Clear
          </Button>
          <Button
            type="button"
            variant={stagedPreset === 'today' ? 'secondary' : 'outline'}
            disabled={stagedPreset === 'all'}
            onClick={onToday}
          >
            Today (default)
          </Button>
          <Button
            type="button"
            variant={stagedPreset === 'all' ? 'secondary' : 'outline'}
            disabled={allLoading || stagedPreset === 'today'}
            onClick={onAll}
          >
            All
          </Button>
          <Button type="button" variant="primary" disabled={!canRun} onClick={onRun}>
            Run
          </Button>
        </div>
      </div>
    </Modal>
  )
}
