import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

export function OrderSummaryPanel({
  customer,
  customerType,
  items,
  subtotal,
  balanceSettled,
  creditApplied,
  totalDue,
  onSubmit,
  submitting,
  error,
}) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">Order Summary</h2>

      <div>
        <div className="font-medium text-gray-900">{customer?.full_name ?? 'No customer selected'}</div>
        <div className="text-sm text-gray-500 capitalize">{customerType.replace('_', ' ')}</div>
      </div>

      <ul className="flex flex-col gap-1 text-sm text-gray-700">
        {items.map((item) => {
          if (item.item_type === 'product') {
            return (
              <li key={item.id} className="flex justify-between">
                <span>
                  {item.product_name} × {item.unit_count} ({Number(item.qty).toFixed(3)}kg)
                </span>
                <span>{formatCurrency(item.subtotal)}</span>
              </li>
            )
          }
          if (item.item_type === 'balance_settlement') {
            return (
              <li key={item.id} className="flex justify-between text-red-600">
                <span>Balance Settlement</span>
                <span>{formatCurrency(item.amount)}</span>
              </li>
            )
          }
          return (
            <li key={item.id} className="flex justify-between text-green-700">
              <span>Credit Applied</span>
              <span>-{formatCurrency(item.amount)}</span>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-sm">
        <div className="flex justify-between text-gray-700">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        {balanceSettled > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Balance settled</span>
            <span>{formatCurrency(balanceSettled)}</span>
          </div>
        )}
        {creditApplied > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Credit applied</span>
            <span>-{formatCurrency(creditApplied)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
        <span className="font-semibold text-gray-900">TOTAL DUE</span>
        <span className="text-2xl font-bold text-primary">{formatCurrency(totalDue)}</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="button" className="w-full" disabled={submitting} onClick={onSubmit}>
        {submitting ? 'Submitting...' : 'Submit Transaction'}
      </Button>
    </Card>
  )
}
