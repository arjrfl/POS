import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

export function SubstandardResolution({ transaction, onSendToPayment, submitting }) {
  const balanceDue = Number(transaction.balance_due)
  const estimatedTotal = Number(transaction.estimated_amount)
  const actualTotal = Number(transaction.actual_amount)
  const isHeavier = balanceDue > 0

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
        ⚠ Weight Variance Detected
      </div>
      <div className="p-3 flex flex-col gap-2 text-sm">
        <div className="flex justify-between text-gray-700">
          <span>Estimated Total</span>
          <span>{formatCurrency(estimatedTotal)}</span>
        </div>
        <div className="flex justify-between text-gray-700">
          <span>Actual Total</span>
          <span>{formatCurrency(actualTotal)}</span>
        </div>
        <p className={`font-semibold ${isHeavier ? 'text-amber-600' : 'text-blue-600'}`}>
          {isHeavier
            ? `Item is heavier by ${formatCurrency(balanceDue)}`
            : `Item is lighter by ${formatCurrency(Math.abs(balanceDue))}`}
        </p>
        <Button type="button" className="w-full" disabled={submitting} onClick={onSendToPayment}>
          {submitting ? 'Sending...' : 'Send to Payment for Adjustment'}
        </Button>
      </div>
    </div>
  )
}
