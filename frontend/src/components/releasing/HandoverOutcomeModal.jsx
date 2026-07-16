import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useCustomer } from '../../hooks/useCustomer'
import { formatCurrency } from '../../utils/format'

const EPS = 0.005

function outcomeText(outcome) {
  if (!outcome) return ''
  const amountPaid = Number(outcome.amount_paid)
  const remaining = Number(outcome.remaining_balance_added)
  const creditAdded = Number(outcome.credit_added)

  if (outcome.child_transaction_type === 'refund') {
    return `${formatCurrency(creditAdded)} saved as customer credit.`
  }
  if (remaining > EPS) {
    return `Customer paid ${formatCurrency(amountPaid)}. Remaining ${formatCurrency(remaining)} added to their balance.`
  }
  return `Customer paid ${formatCurrency(amountPaid)} in full.`
}

export function HandoverOutcomeModal({ open, transaction, outcome, loading, submitting, onClose, onConfirm }) {
  const { data: customer } = useCustomer(transaction?.customer_id)

  return (
    <Modal open={open} onClose={onClose} title="Confirm Handover">
      {!transaction ? null : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-mono font-bold text-lg text-gray-900">{transaction.order_number}</div>
            <div className="text-primary font-semibold">{customer?.full_name ?? '...'}</div>
          </div>

          {loading || !outcome ? (
            <p className="text-sm text-gray-500">Loading outcome...</p>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800">
              {outcomeText(outcome)}
            </div>
          )}

          <Button type="button" className="w-full" disabled={submitting || loading || !outcome} onClick={onConfirm}>
            {submitting ? 'Confirming...' : 'Confirm Handover'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
