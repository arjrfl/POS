import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useCreateUser, useUpdateUser, useRoleOptions } from '../../hooks/useUsers'

function emptyForm() {
  return { full_name: '', username: '', password: '', confirm_password: '', role_id: '' }
}

// mode="edit" deliberately has no role field and no password fields — role is
// immutable after creation (set only here, in mode="create") and password
// changes go through the dedicated Reset Password action instead.
export function UserFormModal({ open, mode, user, onClose, onSuccess, onResetPassword }) {
  const [form, setForm] = useState(emptyForm)
  const [usernameError, setUsernameError] = useState('')
  const [formError, setFormError] = useState('')

  const roleOptions = useRoleOptions()
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const submitting = createUser.isPending || updateUser.isPending

  useEffect(() => {
    if (!open) return
    setUsernameError('')
    setFormError('')
    if (mode === 'edit' && user) {
      setForm({ full_name: user.full_name, username: user.username, password: '', confirm_password: '', role_id: '' })
    } else {
      setForm(emptyForm())
    }
  }, [open, mode, user])

  const setField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    if (field === 'username') setUsernameError('')
  }

  const canSubmit =
    form.full_name.trim().length > 0 &&
    form.username.trim().length > 0 &&
    (mode === 'edit' || (form.password.length > 0 && form.role_id !== ''))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setFormError('')
    setUsernameError('')

    if (mode === 'create' && form.password !== form.confirm_password) {
      setFormError('Passwords do not match')
      return
    }

    try {
      if (mode === 'edit') {
        await updateUser.mutateAsync({
          id: user.id,
          full_name: form.full_name.trim(),
          username: form.username.trim(),
        })
        onSuccess?.('User updated')
      } else {
        await createUser.mutateAsync({
          full_name: form.full_name.trim(),
          username: form.username.trim(),
          password: form.password,
          role_id: Number(form.role_id),
        })
        onSuccess?.('User created')
      }
      onClose()
    } catch (err) {
      // 409 (username taken) belongs under the Username field, not a generic error.
      if (err.status === 409) {
        setUsernameError(err.message)
      } else {
        setFormError(err.message)
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === 'edit' ? `Edit User — ${user?.username}` : 'Add User'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input id="user-form-full-name" label="Full Name" value={form.full_name} onChange={setField('full_name')} required />

        <div className="flex flex-col gap-1">
          <Input id="user-form-username" label="Username" value={form.username} onChange={setField('username')} required />
          {usernameError && <p className="text-sm text-red-600">{usernameError}</p>}
        </div>

        {mode === 'create' && (
          <>
            <Input
              id="user-form-password"
              label="Password"
              type="password"
              value={form.password}
              onChange={setField('password')}
              required
            />
            <Input
              id="user-form-confirm-password"
              label="Confirm Password"
              type="password"
              value={form.confirm_password}
              onChange={setField('confirm_password')}
              required
            />

            <div className="flex flex-col gap-1">
              <label htmlFor="user-form-role" className="text-sm font-medium text-gray-700">
                Role
              </label>
              <select
                id="user-form-role"
                value={form.role_id}
                onChange={setField('role_id')}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light capitalize"
                required
              >
                <option value="">Select role...</option>
                {roleOptions.map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.role_name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={!canSubmit || submitting}>
            {submitting ? 'Saving...' : mode === 'edit' ? 'Save' : 'Create'}
          </Button>
        </div>

        {mode === 'edit' && (
          <Button type="button" variant="warning" className="w-full mt-1" onClick={() => onResetPassword?.(user)}>
            Reset Password
          </Button>
        )}
      </form>
    </Modal>
  )
}
