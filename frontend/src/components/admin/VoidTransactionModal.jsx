import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { post } from '../../services/api'

// Admin-only, password-gated exception to "a completed transaction is
// immutable" (see CLAUDE.md, backend transaction_service.void_transaction).
// Closest existing pattern is ResetPasswordModal (password re-entry + Cancel/
// Confirm), but this is a new component — that one resets someone ELSE's
// password, this one re-authenticates the acting admin's OWN password.
export function VoidTransactionModal({ open, transaction, childOrderNumbers = [], onClose, onVoided, onError }) {
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setPassword('')
      setPasswordError('')
      setSubmitting(false)
    }
  }, [open, transaction?.id])

  if (!transaction) return null

  const canSubmit = reason.trim().length >= 3 && password.length > 0 && !submitting

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setPasswordError('')
    try {
      const updated = await post(`/transactions/${transaction.id}/void`, { reason: reason.trim(), password })
      onVoided?.(updated)
      onClose()
    } catch (err) {
      if (err.status === 401) {
        setPasswordError(err.message || 'Incorrect password')
        setPassword('')
        setSubmitting(false)
        return
      }
      onError?.(err.message || 'Failed to void transaction')
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Void Transaction — ${transaction.order_number}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm font-bold text-red-700">
            This action is permanent and cannot be undone. Stock and any credit/balance effects will be reversed.
          </p>
          {childOrderNumbers.length > 0 && (
            <p className="text-sm text-red-700 mt-1.5">
              This will also void linked transaction(s): {childOrderNumbers.join(', ')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="void-reason" className="text-sm font-medium text-gray-700">
            Reason
          </label>
          <textarea
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-gold resize-none"
            placeholder="Why is this transaction being voided?"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="void-password" className="text-sm font-medium text-gray-700">
            Enter your password to confirm
          </label>
          <input
            id="void-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
        </div>

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" className="flex-1" disabled={!canSubmit}>
            {submitting ? 'Voiding...' : 'Void Transaction'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
