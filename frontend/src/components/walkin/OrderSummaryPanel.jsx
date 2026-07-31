import { Card } from '../ui/Card'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'
import { ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'

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

function PencilIcon() {
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
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

export function OrderSummaryPanel({
  customer,
  customerType,
  items,
  total,
  onRemoveItem,
  onEditItem = null,
  editingRowId = null,
  footer,
  readOnly = false,
  orderNumber = null,
  totalLabel = 'TOTAL',
  headingLabel = 'Order Summary',
  balanceSettlementRow = false,
  // Optional extras rendered next to/under the order number — e.g. Payment's
  // ADJUSTMENT/REFUND badge and "Linked to: {parent_order_number}" note.
  // Kept generic here so this shared panel doesn't need to know about that
  // domain concept itself.
  headerBadge = null,
  headerSubtext = null,
  // Optional full override for the items table body — used for adjustment/refund
  // transactions, whose article table needs to show unadjusted/adjusted rows
  // sourced from the parent transaction rather than plain `items`. Renders inside
  // the same QTY | UNIT | ARTICLES | UNIT PRICE | AMOUNT header as the default
  // table. Leave null for the normal, editable-items behavior (unchanged).
  itemsTable = null,
  // Optional "Delete All" trigger shown next to the header, right-aligned.
  // Only rendered when provided AND items.length > 0 — callers that don't pass
  // it (Payment/Releasing read-only or override-table views) never show it.
  onDeleteAll = null,
}) {
  const typeBadge = customerType ? CUSTOMER_TYPE_BADGE[customerType] : null

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-4">
        {headingLabel && (
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-medium text-gray-700">{headingLabel}</h2>
            {onDeleteAll && items.length > 0 && (
              <button type="button" onClick={onDeleteAll} className="text-sm text-red-600 hover:text-red-800">
                🗑 Delete All
              </button>
            )}
          </div>
        )}
        {orderNumber && (
          <div className="flex items-center gap-2 mb-1">
            <div className="text-lg font-bold text-gray-900">{orderNumber}</div>
            {headerBadge}
          </div>
        )}
        {headerSubtext && <div className="text-xs text-gray-500 mb-1">{headerSubtext}</div>}
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

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-200 mb-4">
        {balanceSettlementRow ? (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2 font-medium">QTY</th>
                <th className="py-2 pr-2 font-medium">UNIT</th>
                <th className="py-2 pr-2 font-medium">ARTICLES</th>
                <th className="py-2 pr-2 font-medium">UNIT PRICE</th>
                <th className="py-2 pr-2 font-medium">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                <td className="py-2 pr-2 text-gray-400">—</td>
                <td className="py-2 pr-2 text-gray-400">—</td>
                <td className="py-2 pr-2 text-gray-500 italic">Balance Settlement</td>
                <td className="py-2 pr-2 text-gray-400">—</td>
                <td className="py-2 pr-2 font-medium text-red-600">{formatCurrency(total)}</td>
              </tr>
            </tbody>
          </table>
        ) : itemsTable ? (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[0]}`}>QTY</th>
                <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[1]}`}>UNIT</th>
                <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[2]}`}>ARTICLES</th>
                <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[3]}`}>UNIT PRICE</th>
                <th className={`py-2 pr-2 font-medium ${ARTICLE_ROW_COLUMN_WIDTHS[4]}`}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>{itemsTable}</tbody>
          </table>
        ) : items.length === 0 ? (
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
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 last:border-b-0 align-top ${
                    item.id === editingRowId ? 'bg-blue-50 border-l-4 border-l-blue-400' : ''
                  }`}
                >
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
                      <div className="flex items-center gap-2">
                        {onEditItem && (
                          <button
                            type="button"
                            onClick={() => onEditItem(item.id)}
                            className="text-gray-500 hover:text-gray-700"
                            aria-label="Edit item"
                          >
                            <PencilIcon />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          className="text-red-600 hover:text-red-800"
                          aria-label="Remove item"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-shrink-0">
        <div className="border-t border-gray-200 pt-4 flex justify-between items-center">
          <span className="font-semibold text-gray-900">{totalLabel}</span>
          <span className="text-2xl font-bold text-primary">{formatCurrency(total)}</span>
        </div>

        {footer}
      </div>
    </Card>
  )
}
