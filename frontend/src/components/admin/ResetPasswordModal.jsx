import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useResetPassword } from '../../hooks/useUsers'

export function ResetPasswordModal({ open, user, onClose, onSuccess }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const resetPassword = useResetPassword()

  useEffect(() => {
    if (open) {
      setNewPassword('')
      setConfirmPassword('')
      setError('')
    }
  }, [open, user])

  if (!user) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setError('')
    try {
      await resetPassword.mutateAsync({ id: user.id, new_password: newPassword, confirm_password: confirmPassword })
      onSuccess?.('Password reset')
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Reset Password — ${user.username}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          id="reset-password-new"
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <Input
          id="reset-password-confirm"
          label="Confirm Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={resetPassword.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={resetPassword.isPending}>
            {resetPassword.isPending ? 'Saving...' : 'Reset Password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
