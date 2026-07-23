import { useState } from 'react'
import { Pencil, Power, Trash2, History } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { Toast } from '../ui/Toast'
import { useUsersList, useToggleUserStatus, useDeleteUser } from '../../hooks/useUsers'
import { UserFormModal } from './UserFormModal'
import { ResetPasswordModal } from './ResetPasswordModal'
import { UserHistoryModal } from './UserHistoryModal'

const ROLE_BADGE_STYLES = {
  receiver: 'bg-blue-100 text-blue-800',
  payment: 'bg-green-100 text-green-800',
  releasing: 'bg-amber-100 text-amber-800',
  admin: 'bg-purple-100 text-purple-800',
}

function RoleBadge({ role }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE_STYLES[role] || 'bg-gray-100 text-gray-700'}`}
    >
      {role}
    </span>
  )
}

function StatusPill({ isActive }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

const ROLE_FILTER_OPTIONS = ['receiver', 'payment', 'releasing', 'admin']

function UserRow({
  user,
  confirmMode,
  actingId,
  onEdit,
  onHistory,
  onToggle,
  onDelete,
  onConfirmToggle,
  onConfirmDelete,
  onCancelConfirm,
}) {
  if (confirmMode) {
    const isToggle = confirmMode === 'toggle'
    const willDeactivate = user.is_active
    const label = isToggle
      ? `${willDeactivate ? 'Deactivate' : 'Reactivate'} "${user.full_name}"?`
      : `Delete "${user.full_name}"? This cannot be undone.`

    return (
      <tr className="border-b border-yellow-300 bg-yellow-50">
        <td colSpan={6} className="px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-amber-800">{label}</span>
            <div className="flex gap-2 shrink-0">
              <Button
                type="button"
                variant="secondary"
                className="!px-3 !py-1 text-xs"
                onClick={onCancelConfirm}
                disabled={actingId === user.id}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={isToggle ? (willDeactivate ? 'danger' : 'success') : 'danger'}
                className="!px-3 !py-1 text-xs"
                onClick={() => (isToggle ? onConfirmToggle(user) : onConfirmDelete(user))}
                disabled={actingId === user.id}
              >
                {actingId === user.id ? 'Saving...' : 'Yes'}
              </Button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50">
      <td className="px-4 py-2 text-sm text-left font-medium text-gray-900">{user.full_name}</td>
      <td className="px-4 py-2 text-sm text-left font-mono text-gray-600">{user.username}</td>
      <td className="px-4 py-2 text-center">
        <RoleBadge role={user.role_name} />
      </td>
      <td className="px-4 py-2 text-center">
        <StatusPill isActive={user.is_active} />
      </td>
      <td className="px-4 py-2 text-sm text-center text-gray-500">
        {new Date(user.created_at).toLocaleDateString()}
      </td>
      <td className="px-4 py-2 text-center whitespace-nowrap">
        <div className="flex gap-1 justify-center">
          <button
            type="button"
            onClick={() => onEdit(user)}
            className="p-1.5 rounded-md text-gray-500 hover:text-primary hover:bg-primary/10"
            aria-label={`Edit ${user.full_name}`}
            title="Edit"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => onToggle(user)}
            className={`p-1.5 rounded-md hover:bg-gray-100 ${user.is_active ? 'text-green-600' : 'text-gray-400'}`}
            aria-label={`Toggle status for ${user.full_name}`}
            title="Toggle Status"
          >
            <Power size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(user)}
            className="p-1.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50"
            aria-label={`Delete ${user.full_name}`}
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => onHistory(user)}
            className="p-1.5 rounded-md text-gray-500 hover:text-primary hover:bg-primary/10"
            aria-label={`History for ${user.full_name}`}
            title="History"
          >
            <History size={16} />
          </button>
        </div>
      </td>
    </tr>
  )
}

export function UsersSection() {
  const [searchInput, setSearchInput] = useState('')
  const [roleInput, setRoleInput] = useState('')
  const [statusInput, setStatusInput] = useState('')
  const [filters, setFilters] = useState({ search: '', role: '', status: '' })

  const [formModal, setFormModal] = useState(null) // { mode: 'create' } | { mode: 'edit', user }
  const [resettingUser, setResettingUser] = useState(null)
  const [historyUser, setHistoryUser] = useState(null)
  const [confirmState, setConfirmState] = useState(null) // { id, mode: 'toggle' | 'delete' }
  const [actingId, setActingId] = useState(null)
  const [toast, setToast] = useState(null)

  const { data: users, isLoading } = useUsersList(filters)
  const toggleStatus = useToggleUserStatus()
  const deleteUser = useDeleteUser()

  const showToast = (message, variant = 'info') => {
    setToast({ message, variant })
    window.setTimeout(() => setToast(null), 3500)
  }

  const runSearch = () => setFilters({ search: searchInput.trim(), role: roleInput, status: statusInput })

  const handleConfirmToggle = async (user) => {
    setActingId(user.id)
    try {
      await toggleStatus.mutateAsync(user.id)
      showToast(user.is_active ? 'User deactivated' : 'User reactivated', 'success')
      setConfirmState(null)
    } catch (err) {
      // Surface the backend's own message (self-toggle / last-active-admin
      // block) as-is — don't replace it with a generic error.
      showToast(err.message, 'error')
    } finally {
      setActingId(null)
    }
  }

  const handleConfirmDelete = async (user) => {
    setActingId(user.id)
    try {
      await deleteUser.mutateAsync(user.id)
      showToast('User deleted', 'success')
      setConfirmState(null)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setActingId(null)
    }
  }

  return (
    <Card className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="w-56">
            <Input
              id="user-search"
              label="Search users"
              placeholder="Name or username..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="user-role-filter" className="text-sm font-medium text-gray-700">
              Role
            </label>
            <select
              id="user-role-filter"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light capitalize"
            >
              <option value="">All roles</option>
              {ROLE_FILTER_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="user-status-filter" className="text-sm font-medium text-gray-700">
              Status
            </label>
            <select
              id="user-status-filter"
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <Button type="button" variant="primary" onClick={runSearch}>
            Search
          </Button>
        </div>

        <Button type="button" variant="primary" onClick={() => setFormModal({ mode: 'create' })}>
          + Add User
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {!isLoading && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full table-auto border-collapse">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-4 py-2">Full Name</th>
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2 text-center">Role</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-center">Date Created</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-sm text-gray-500">
                    No users found.
                  </td>
                </tr>
              )}
              {users?.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  confirmMode={confirmState?.id === user.id ? confirmState.mode : null}
                  actingId={actingId}
                  onEdit={(u) => setFormModal({ mode: 'edit', user: u })}
                  onHistory={setHistoryUser}
                  onToggle={(u) => setConfirmState({ id: u.id, mode: 'toggle' })}
                  onDelete={(u) => setConfirmState({ id: u.id, mode: 'delete' })}
                  onConfirmToggle={handleConfirmToggle}
                  onConfirmDelete={handleConfirmDelete}
                  onCancelConfirm={() => setConfirmState(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal
        open={!!formModal}
        mode={formModal?.mode}
        user={formModal?.mode === 'edit' ? formModal.user : null}
        onClose={() => setFormModal(null)}
        onSuccess={(message) => showToast(message, 'success')}
        onResetPassword={(u) => {
          setFormModal(null)
          setResettingUser(u)
        }}
      />

      <ResetPasswordModal
        open={!!resettingUser}
        user={resettingUser}
        onClose={() => setResettingUser(null)}
        onSuccess={(message) => showToast(message, 'success')}
      />

      <UserHistoryModal open={!!historyUser} user={historyUser} onClose={() => setHistoryUser(null)} />

      <Toast toast={toast} />
    </Card>
  )
}
