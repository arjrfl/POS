import { Pencil } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

// Local to this table only — ArticleRows' own ARTICLE_ROW_COLUMN_WIDTHS is a
// 5-column layout shared by several other consumers, and doesn't have an
// ACTION column, so it isn't reused here.
const COLUMN_WIDTHS = ['w-[12%]', 'w-[14%]', 'w-[24%]', 'w-[18%]', 'w-[18%]', 'w-[14%]']

// `items` is the same product-joined display list TransactionDetailPanel
// already computes for its own article table (displayItems) — reused as-is
// here rather than re-deriving it (which would mean a second useProducts()
// call and a redundant /api/products refetch on every modal open).
export function EditItemsModal({ transaction, items, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Edit Items — ${transaction.order_number}`} size="lg">
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr] gap-4">
          <div className="h-full min-h-0 flex flex-col border border-gray-200 rounded-md overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto pt-0 px-3 pb-3">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[0]}`}>QTY</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[1]}`}>UNIT</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[2]}`}>ARTICLES</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[3]}`}>UNIT PRICE</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[4]}`}>AMOUNT</th>
                    <th className={`py-2 pr-2 font-medium ${COLUMN_WIDTHS[5]}`}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100 last:border-b-0 align-top">
                      <td className="py-2 pr-2 text-gray-700">{item.quantity_kg.toFixed(3)}</td>
                      <td className="py-2 pr-2 text-gray-700">{item.unit_count}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-900">{item.product_name}</div>
                        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
                      </td>
                      <td className="py-2 pr-2 text-gray-700">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(item.subtotal)}</td>
                      <td className="py-2 pr-2">
                        <span className="inline-flex text-gray-500" aria-label={`Edit ${item.product_name}`}>
                          <Pencil size={16} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="h-full min-h-0 border border-gray-200 rounded-md" />
        </div>

        <div className="flex-shrink-0 flex justify-end mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
