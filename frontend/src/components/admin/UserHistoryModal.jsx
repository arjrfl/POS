import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useUserHistory } from '../../hooks/useUsers'

function diffLine(log) {
  const oldVal = log.old_value ? JSON.parse(log.old_value) : null
  const newVal = JSON.parse(log.new_value)

  switch (log.change_type) {
    case 'created':
      return `Account created as ${newVal.role_name}`
    case 'password_reset':
      return 'Password reset'
    case 'deactivated':
      return 'Account deactivated'
    case 'reactivated':
      return 'Account reactivated'
    case 'updated': {
      const lines = []
      if ('full_name' in newVal) lines.push(`Full name changed: ${oldVal.full_name} → ${newVal.full_name}`)
      if ('username' in newVal) lines.push(`Username changed: ${oldVal.username} → ${newVal.username}`)
      return lines.length > 0 ? lines.join('; ') : 'Account updated'
    }
    default:
      return log.change_type
  }
}

export function UserHistoryModal({ open, user, onClose }) {
  const { data: history, isLoading } = useUserHistory(user?.id)

  return (
    <Modal open={open} onClose={onClose} title={user ? `History — ${user.username}` : 'History'}>
      <div className="flex flex-col gap-3">
        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && history?.length === 0 && <p className="text-sm text-gray-500">No changes yet</p>}
        {!isLoading && history?.length > 0 && (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
            {history.map((log) => (
              <div
                key={log.id}
                className="text-sm text-gray-700 flex flex-col gap-0.5 pb-2 border-b border-gray-100 last:border-0 last:pb-0"
              >
                <span className="font-medium">{diffLine(log)}</span>
                <span className="text-xs text-gray-500">by {log.changed_by_full_name}</span>
                <span className="text-xs text-gray-400">{new Date(log.changed_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        <Button type="button" variant="secondary" className="w-full mt-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}
