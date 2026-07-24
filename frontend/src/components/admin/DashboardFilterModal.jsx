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
  onClear,
  onAll,
  allLoading,
}) {
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
        />
        <Input
          id="dashboard-filter-to"
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => onChangeTo(e.target.value)}
        />

        {isInvalidRange && <p className="text-sm text-red-600">From date must be before or equal to To date</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="outline" onClick={onClear}>
            Clear Filter
          </Button>
          <Button type="button" variant="outline" disabled={allLoading} onClick={onAll}>
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
