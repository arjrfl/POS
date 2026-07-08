import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

export function OrderSummaryPanel({
  customer,
  items,
  subtotal,
  balanceSettled,
  creditApplied,
  totalDue,
  onRemoveItem,
  onUpdateAmount,
  maxBalanceAmount,
  maxCreditAmount,
  canSubmit,
  onSubmit,
  submitting,
  error,
}) {
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-3">
        <h2 className="text-sm font-medium text-gray-700 mb-1">Order Summary</h2>
        {customer ? (
          <>
            <div className="text-xl font-bold text-primary">{customer.full_name}</div>
            {customer.address && <div className="text-sm text-gray-500">{customer.address}</div>}
          </>
        ) : (
          <div className="text-gray-500 italic">No customer selected</div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-200">
        {items.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">No items added yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2 font-medium">QTY</th>
                <th className="py-2 pr-2 font-medium">UNIT</th>
                <th className="py-2 pr-2 font-medium">ARTICLES</th>
                <th className="py-2 pr-2 font-medium">UNIT PRICE</th>
                <th className="py-2 pr-2 font-medium">AMOUNT</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-b-0 align-top">
                  {item.item_type === 'product' ? (
                    <>
                      <td className="py-2 pr-2 text-gray-700">{Number(item.quantity_kg).toFixed(3)}</td>
                      <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-900">{item.product_name}</div>
                        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                      </td>
                      <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-2 text-gray-400">—</td>
                      <td className="py-2 pr-2 text-gray-400">—</td>
                      <td
                        className={`py-2 pr-2 font-medium ${
                          item.item_type === 'balance_settlement' ? 'text-red-600' : 'text-green-700'
                        }`}
                      >
                        {item.item_type === 'balance_settlement' ? 'Balance Settlement' : 'Credit Applied'}
                      </td>
                      <td className="py-2 pr-2 text-gray-400">—</td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={item.item_type === 'balance_settlement' ? maxBalanceAmount : maxCreditAmount}
                          value={item.amount}
                          onChange={(e) => onUpdateAmount(item.id, e.target.value)}
                          className={`w-24 px-2 py-1 border rounded-md font-medium ${
                            item.item_type === 'balance_settlement'
                              ? 'border-red-200 text-red-600'
                              : 'border-green-200 text-green-700'
                          }`}
                        />
                      </td>
                    </>
                  )}
                  <td className="py-2 pl-1">
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.id)}
                      className="text-red-600 hover:text-red-800"
                      aria-label="Remove item"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-shrink-0">
        <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {balanceSettled > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Balance Settled</span>
              <span>{formatCurrency(balanceSettled)}</span>
            </div>
          )}
          {creditApplied > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Credit Applied</span>
              <span>-{formatCurrency(creditApplied)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 mt-2 pt-3 flex justify-between items-center">
          <span className="font-semibold text-gray-900">TOTAL DUE</span>
          <span className="text-2xl font-bold text-primary">{formatCurrency(totalDue)}</span>
        </div>

        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <Button type="button" className="w-full mt-3" disabled={submitting || !canSubmit} onClick={onSubmit}>
          {submitting ? 'Submitting...' : 'Submit Transaction'}
        </Button>
      </div>
    </Card>
  )
}
