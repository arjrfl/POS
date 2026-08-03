import { Modal } from '../ui/Modal'

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

// Read-only viewer for a voided transaction's transaction_void_log row —
// same "Show" style as Tabulation Logs/Order Items Update Logs, but the data
// is already sitting on the chain node this modal is given (void_info is
// populated by _build_transaction_response for any 'voided' transaction, see
// backend/app/services/transaction_service.py) — no separate fetch needed.
function VoidLogRow({ label, voidInfo }) {
  if (!voidInfo) return null
  return (
    <div className="bg-gray-100 border border-brand-black/20 rounded-lg p-3 flex flex-col gap-1">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-gray-500">Voided By</span>
        <span className="text-gray-900">{voidInfo.voided_by_user_name}</span>
      </div>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-gray-500">Voided At</span>
        <span className="text-gray-900">{formatDateTime(voidInfo.voided_at)}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-sm pt-1 border-t border-gray-200 mt-1">
        <span className="text-gray-500">Reason</span>
        <span className="text-gray-900">{voidInfo.void_reason}</span>
      </div>
    </div>
  )
}

export function VoidLogsModal({ open, transaction, childTransactions = [], onClose }) {
  if (!transaction) return null

  return (
    <Modal open={open} onClose={onClose} title={`Void Logs — ${transaction.order_number}`}>
      <div className="flex flex-col gap-3">
        <VoidLogRow label={transaction.order_number} voidInfo={transaction.void_info} />
        {childTransactions.map((child) => (
          <VoidLogRow key={child.id} label={`Linked — ${child.order_number}`} voidInfo={child.void_info} />
        ))}
      </div>
    </Modal>
  )
}
