import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

export function AdjustStockModal({ open, product, onClose, onConfirm }) {
  const [delta, setDelta] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setDelta('')
      setNotes('')
      setError('')
    }
  }, [open, product])

  if (!product) return null

  const handleConfirm = async () => {
    const parsed = Number(delta)
    if (delta.trim() === '' || Number.isNaN(parsed) || parsed === 0) {
      setError('Enter a non-zero adjustment amount')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onConfirm(product.id, { delta: parsed, notes: notes.trim() || null })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adjust Stock">
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-medium text-gray-900">{product.product_name}</p>
          {product.brand_name && <p className="text-sm text-gray-500">{product.brand_name}</p>}
        </div>

        <div className="text-sm text-gray-700">
          Current stock: <span className="font-semibold">{Number(product.stock_quantity)}</span>
        </div>

        <Input
          id="adjust-stock-delta"
          label="Adjustment amount"
          type="number"
          step="0.001"
          placeholder="e.g. +50 or -5"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />

        <Input
          id="adjust-stock-notes"
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Saving...' : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
