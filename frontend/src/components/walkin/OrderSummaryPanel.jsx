import { Card } from '../ui/Card'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'

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
  customerType,
  items,
  total,
  onRemoveItem,
  footer,
  readOnly = false,
  orderNumber = null,
  totalLabel = 'TOTAL',
  headingLabel = 'Order Summary',
}) {
  const typeBadge = customerType ? CUSTOMER_TYPE_BADGE[customerType] : null

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-3">
        {headingLabel && <h2 className="text-sm font-medium text-gray-700 mb-1">{headingLabel}</h2>}
        {orderNumber && <div className="text-lg font-bold text-gray-900 mb-1">{orderNumber}</div>}
        {customer ? (
          <>
            <div className="text-xl font-bold text-primary">{customer.full_name}</div>
            {customer.address && <div className="text-sm text-gray-500">{customer.address}</div>}
            {typeBadge && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 mt-1 rounded-full text-xs font-medium ${typeBadge.className}`}
              >
                {typeBadge.label}
              </span>
            )}
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
                {!readOnly && <th className="py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-b-0 align-top">
                  <td className="py-2 pr-2 text-gray-700">{Number(item.quantity_kg).toFixed(3)}</td>
                  <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium text-gray-900">{item.product_name}</div>
                    {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                  </td>
                  <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                  <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                  {!readOnly && (
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
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-shrink-0">
        <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
          <span className="font-semibold text-gray-900">{totalLabel}</span>
          <span className="text-2xl font-bold text-primary">{formatCurrency(total)}</span>
        </div>

        {footer}
      </div>
    </Card>
  )
}
