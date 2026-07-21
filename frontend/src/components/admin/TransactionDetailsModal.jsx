import { Button } from '../ui/Button'
import { FullScreenModal } from '../ui/FullScreenModal'

export function TransactionDetailsModal({ transactionId, onClose }) {
  return (
    <FullScreenModal open={true} onClose={onClose} title="Transaction History">
      <div className="flex flex-col gap-4 h-full min-h-0">
        <div className="shrink-0">
          <Button type="button" variant="secondary" onClick={onClose}>
            ‹ Back
          </Button>
        </div>

        <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg p-4" />
      </div>
    </FullScreenModal>
  )
}
