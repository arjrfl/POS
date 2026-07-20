import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

// Same palette as Navbar's ROLE_BADGE_STYLES — only releasing/admin can
// write products, so those are the only two entries an audit log ever shows.
const ROLE_TAG_STYLES = {
  releasing: 'bg-orange-100 text-orange-800',
  admin: 'bg-red-100 text-red-800',
}

function RoleTag({ role }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${ROLE_TAG_STYLES[role] || 'bg-gray-100 text-gray-700'}`}
    >
      {role}
    </span>
  )
}

function changeLabel(changeType) {
  return changeType.replace(/_/g, ' ')
}

// Presentation-only — the audit log fetch that feeds `history` still lives
// in InventoryView's FieldsPanel; this modal just renders what it's given.
export function ChangeHistoryModal({ open, product, history, loading, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={product ? `Change History — #${product.id}` : 'Change History'}>
      <div className="flex flex-col gap-3">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {!loading && history?.length === 0 && <p className="text-sm text-gray-500">No changes yet</p>}
        {!loading && history?.length > 0 && (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
            {history.map((log) => (
              <div
                key={log.id}
                className="text-sm text-gray-700 flex flex-col gap-0.5 pb-2 border-b border-gray-100 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium capitalize">{changeLabel(log.change_type)}</span>
                  <RoleTag role={log.changed_by_role} />
                  <span className="text-gray-500">by {log.changed_by_full_name}</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(log.changed_at).toLocaleString()}</span>
                {log.notes && <span className="text-xs text-gray-600 italic">{log.notes}</span>}
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
