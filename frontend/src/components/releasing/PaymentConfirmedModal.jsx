import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useCustomer } from '../../hooks/useCustomer'
import { usePaymentMethods } from '../../hooks/usePaymentMethods'
import { formatCurrency } from '../../utils/format'
import { PAYMENT_METHOD_LABEL } from '../../utils/paymentMethod'

const EPS = 0.005

function paidViaText(payments, methodsById) {
  return payments
    .map((pd) => {
      const methodName = methodsById.get(pd.payment_method_id)
      const label = PAYMENT_METHOD_LABEL[methodName] ?? methodName ?? 'Unknown'
      const ref = pd.ref_number ? ` (Ref: ${pd.ref_number})` : ''
      return `${formatCurrency(pd.amount)} via ${label}${ref}`
    })
    .join(', ')
}

// Lightweight confirmation panel for a plain online order once Payment has
// confirmed payment (transaction_status 'pending_handover') — the online
// counterpart to HandoverOutcomeModal, but everything it needs (payment_details,
// total_due) is already on the transaction object from the queue list, so
// unlike the substandard flow there's no separate outcome fetch before opening.
export function PaymentConfirmedModal({ open, transaction, submitting, onClose, onConfirm }) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: methods } = usePaymentMethods()

  const methodsById = new Map((methods ?? []).map((m) => [m.id, m.payment_method_name]))
  const creditMethodId = (methods ?? []).find((m) => m.payment_method_name === 'credit')?.id
  const realPayments = (transaction?.payment_details ?? []).filter((pd) => pd.payment_method_id !== creditMethodId)
  const amountPaid = realPayments.reduce((sum, pd) => sum + Number(pd.amount), 0)
  const totalDue = Number(transaction?.total_due ?? 0)
  const remaining = Math.max(totalDue - amountPaid, 0)
  const isPartial = remaining > EPS

  return (
    <Modal open={open} onClose={onClose} title="Confirm Handover">
      {!transaction ? null : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-mono font-bold text-lg text-gray-900">{transaction.order_number}</div>
            <div className="text-primary font-semibold">{customer?.full_name ?? '...'}</div>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-md p-3 text-sm text-indigo-800">
            {realPayments.length === 0
              ? 'No payment on record for this transaction.'
              : isPartial
                ? `Customer paid ${paidViaText(realPayments, methodsById)}. Remaining ${formatCurrency(remaining)} added to their balance.`
                : `Customer paid ${paidViaText(realPayments, methodsById)}.`}
          </div>

          <Button type="button" className="w-full" disabled={submitting} onClick={onConfirm}>
            {submitting ? 'Confirming...' : 'Confirm Handover'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
