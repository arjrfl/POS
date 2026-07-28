import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

// TIN/BUS. STYLE are per-print-job only — never persisted, never pre-filled
// from a previous print. Local state resets on every close so the fields are
// always blank the next time this modal opens, regardless of what was
// entered (or printed) last time.
export function PrintDetailsModal({ open, onClose, onConfirm }) {
  const [tin, setTin] = useState('')
  const [busStyle, setBusStyle] = useState('')

  const closeAndReset = () => {
    setTin('')
    setBusStyle('')
    onClose()
  }

  const handlePrint = () => {
    onConfirm(tin, busStyle)
    closeAndReset()
  }

  return (
    <Modal open={open} onClose={closeAndReset} title="Print Details">
      <div className="flex flex-col gap-4">
        <Input label="TIN" id="print-details-tin" value={tin} onChange={(e) => setTin(e.target.value)} />
        <Input
          label="BUS. STYLE"
          id="print-details-bus-style"
          value={busStyle}
          onChange={(e) => setBusStyle(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={closeAndReset}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={handlePrint}>
            Print
          </Button>
        </div>
      </div>
    </Modal>
  )
}
