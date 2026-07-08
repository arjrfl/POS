import { useEffect, useRef } from 'react'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

export function SubstandardResolution({ transaction, customer, onResolve, submitting }) {
  const balanceDue = Number(transaction.balance_due)
  const hasEnoughCredit = balanceDue > 0 && !!customer && Number(customer.net_balance) >= balanceDue
  const isAutoCase = balanceDue === 0 || hasEnoughCredit

  // Both the exact-match and enough-credit cases auto-resolve with no Releasing
  // decision needed — the backend ignores `outcome` entirely on those paths, so
  // any valid literal works here. Guard with a ref (not just a submitting check)
  // because StrictMode double-invokes effects in dev, which would otherwise fire
  // this mutating call twice.
  const autoResolvedRef = useRef(false)
  useEffect(() => {
    if (!isAutoCase || autoResolvedRef.current) return
    autoResolvedRef.current = true
    onResolve('pay_now')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoCase])

  if (balanceDue === 0) {
    return <p className="text-sm font-medium text-green-700">Exact weight — Transaction complete</p>
  }

  if (balanceDue > 0) {
    if (hasEnoughCredit) {
      return <p className="text-sm font-medium text-green-700">Credit auto-applied from customer balance</p>
    }
    if (!customer) {
      return <p className="text-sm text-gray-500">Checking customer balance...</p>
    }

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-gray-900">
          Actual weight is heavier. Customer owes {formatCurrency(balanceDue)}
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={submitting} onClick={() => onResolve('pay_now')}>
            Customer Pays Now
          </Button>
          <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => onResolve('utang')}>
            Save as Balance (Utang)
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-900">
        Actual weight is lighter. Store owes {formatCurrency(Math.abs(balanceDue))}
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={submitting} onClick={() => onResolve('refund_now')}>
          Refund Customer Now
        </Button>
        <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => onResolve('save_credit')}>
          Save as Credit
        </Button>
      </div>
    </div>
  )
}
