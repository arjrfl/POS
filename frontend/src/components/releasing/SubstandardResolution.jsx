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
    return (
      <div className="bg-green-50 border border-green-300 rounded-md p-3 text-sm text-green-800">
        <p className="font-semibold">Exact weight ✓</p>
      </div>
    )
  }

  if (balanceDue > 0) {
    if (hasEnoughCredit) {
      return (
        <div className="bg-green-50 border border-green-300 rounded-md p-3 text-sm text-green-800">
          <p className="font-semibold">Credit auto-applied ✓</p>
        </div>
      )
    }
    if (!customer) {
      return <p className="text-sm text-gray-500">Checking customer balance...</p>
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="bg-yellow-50 border border-yellow-300 rounded-md p-3 text-sm text-yellow-800">
          <p className="font-semibold">Item is heavier than estimated</p>
          <p className="mt-1">Customer owes {formatCurrency(balanceDue)} extra</p>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={submitting} onClick={() => onResolve('pay_now')}>
            Customer Pays Now
          </Button>
          <Button variant="warning" className="flex-1" disabled={submitting} onClick={() => onResolve('utang')}>
            Save as Balance
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-blue-50 border border-blue-300 rounded-md p-3 text-sm text-blue-800">
        <p className="font-semibold">Item is lighter than estimated</p>
        <p className="mt-1">Store owes customer {formatCurrency(Math.abs(balanceDue))}</p>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={submitting} onClick={() => onResolve('refund_now')}>
          Refund Customer Now
        </Button>
        <Button variant="warning" className="flex-1" disabled={submitting} onClick={() => onResolve('save_credit')}>
          Save as Credit
        </Button>
      </div>
    </div>
  )
}
