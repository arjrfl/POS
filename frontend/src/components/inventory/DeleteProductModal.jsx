import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

export function DeleteProductModal({ open, product, onClose, onConfirm }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (open) {
      setError('')
      setBlocked(false)
    }
  }, [open, product])

  if (!product) return null

  const handleConfirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(product.id)
      onClose()
    } catch (err) {
      setError(err.message)
      if (err.status === 409) setBlocked(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Delete ${product.product_name}?`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          This will permanently remove this product and its history. This cannot be undone.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            {blocked ? 'Close' : 'Cancel'}
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            onClick={handleConfirm}
            disabled={submitting || blocked}
          >
            {submitting ? 'Deleting...' : 'Delete Permanently'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
