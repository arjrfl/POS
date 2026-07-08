import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

export function OrderItemsList({ items, onRemove, onUpdateAmount, maxBalanceAmount, maxCreditAmount }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No items added yet.</p>
  }

  const productItems = items.filter((item) => item.item_type === 'product')
  const otherItems = items.filter((item) => item.item_type !== 'product')

  return (
    <div className="flex flex-col gap-3">
      {productItems.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-1 pr-2 font-medium">Product Name</th>
                <th className="py-1 pr-2 font-medium">Brand</th>
                <th className="py-1 pr-2 font-medium">Unit Weight</th>
                <th className="py-1 pr-2 font-medium">Unit Price</th>
                <th className="py-1 pr-2 font-medium">Unit Count</th>
                <th className="py-1 pr-2 font-medium">QTY</th>
                <th className="py-1 pr-2 font-medium">Total</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {productItems.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2 pr-2 font-medium text-gray-900">{item.product_name}</td>
                  <td className="py-2 pr-2 text-gray-600">{item.brand_name ?? '—'}</td>
                  <td className="py-2 pr-2 text-gray-600">{Number(item.unit_weight_kg).toFixed(3)}kg</td>
                  <td className="py-2 pr-2 text-gray-600">{formatCurrency(item.unit_price)}</td>
                  <td className="py-2 pr-2 text-gray-600">{item.unit_count}</td>
                  <td className="py-2 pr-2 text-gray-600">{Number(item.qty).toFixed(3)}kg</td>
                  <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                  <td className="py-2">
                    <Button type="button" variant="danger" onClick={() => onRemove(item.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otherItems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {otherItems.map((item) => (
            <li key={item.id}>
              <Card className="flex items-center justify-between gap-3">
                {item.item_type === 'balance_settlement' && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-red-600">Balance Settlement</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxBalanceAmount}
                      value={item.amount}
                      onChange={(e) => onUpdateAmount(item.id, e.target.value)}
                      className="w-28"
                    />
                  </div>
                )}

                {item.item_type === 'credit_usage' && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-green-700">Credit Applied</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxCreditAmount}
                      value={item.amount}
                      onChange={(e) => onUpdateAmount(item.id, e.target.value)}
                      className="w-28"
                    />
                  </div>
                )}

                <Button type="button" variant="danger" onClick={() => onRemove(item.id)}>
                  Remove
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
