import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

// Per-unit weight entry modal launched from ProductSelector's Tabulation
// button. Row count always tracks Unit Count. Rows start blank unless a
// valid (non-cleared) breakdown is already stored for the pending line, in
// which case they're prefilled — reset via the effect below on every open
// rather than on mount/unmount, since Modal keeps this component alive in
// the tree even while closed (see Modal.jsx: it renders null, not unmount).
export function TabulationModal({ open, unitCount, initialValues, onConfirm, onClose }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!open) return
    if (Array.isArray(initialValues) && initialValues.length === unitCount) {
      setRows(initialValues.map((value) => String(value)))
    } else {
      setRows(Array.from({ length: unitCount }, () => ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleRowChange = (index, value) => {
    setRows((prev) => prev.map((row, i) => (i === index ? value : row)))
  }

  const parsedRows = rows.map((row) => (row === '' ? null : Number(row)))
  const allValid = parsedRows.length > 0 && parsedRows.every((value) => value != null && !Number.isNaN(value) && value >= 0)
  const rawTotal = parsedRows.reduce((sum, value) => sum + (value || 0), 0)
  const total = Math.round(rawTotal * 1000) / 1000

  const handleConfirm = () => {
    if (!allValid) return
    onConfirm(parsedRows, total)
  }

  return (
    <Modal open={open} onClose={onClose} title="Tabulation">
      <div className="flex flex-col gap-3">
        <div className="max-h-80 overflow-y-auto flex flex-col gap-2 pr-1">
          {rows.map((value, index) => (
            <Input
              key={index}
              id={`tabulation-row-${index}`}
              label={`Unit ${index + 1} (kg)`}
              type="number"
              step="0.001"
              min="0"
              placeholder="0.000"
              value={value}
              onChange={(e) => handleRowChange(index, e.target.value)}
            />
          ))}
        </div>

        <div>
          <span className="text-sm font-medium text-gray-700">Total</span>
          <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900 font-semibold">{total.toFixed(3)} kg</div>
        </div>

        <div className="flex gap-2">
          <Button type="button" onClick={handleConfirm} className="flex-1" disabled={!allValid}>
            Confirm
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
