import { useState } from 'react'
import { useProducts } from '../../hooks/useProducts'
import { Badge } from '../ui/Badge'
import { formatCurrency, formatStock, formatWeight } from '../../utils/format'

// Placeholder — adjust to the real business number once Operations defines one.
const LOW_STOCK_THRESHOLD = 5

function ProductRow({ product }) {
  const lowStock = Number(product.stock_quantity) < LOW_STOCK_THRESHOLD
  const rowClass = lowStock
    ? 'bg-red-50 border-l-4 border-l-red-500 border-b border-gray-200'
    : 'border-b border-gray-200 hover:bg-gray-50'

  return (
    <tr className={rowClass}>
      <td className="px-4 py-2 text-sm text-left">
        <div className="font-medium text-gray-900">{product.product_name}</div>
        {product.brand_name && <div className="text-xs text-gray-500">{product.brand_name}</div>}
      </td>
      <td className="px-4 py-2 text-sm text-left text-gray-600">{product.brand_name ?? '—'}</td>
      <td className="px-4 py-2 text-sm text-center tabular-nums text-gray-800">
        {formatWeight(product.unit_weight_kg)}
      </td>
      <td className="px-4 py-2 text-sm text-right tabular-nums text-gray-800">
        {Number(product.unit_price_php) === 0 ? (
          <span className="text-gray-400 italic">No price set</span>
        ) : (
          formatCurrency(product.unit_price_php)
        )}
      </td>
      <td
        className={`px-4 py-2 text-sm text-right tabular-nums ${lowStock ? 'font-semibold text-red-700' : 'text-gray-800'}`}
      >
        {formatStock(product.stock_quantity)}
      </td>
      <td className="px-4 py-2 text-center">
        <Badge status={product.product_status} />
      </td>
    </tr>
  )
}

export function OperationsStockTable() {
  const [search, setSearch] = useState('')
  const { data: products, isLoading } = useProducts()

  const term = search.trim().toLowerCase()
  const filtered = term
    ? (products ?? []).filter((product) => product.product_name?.toLowerCase().includes(term))
    : (products ?? [])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 mb-3">
        <input
          type="text"
          placeholder="Search by product name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-gold"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="table-auto w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Product Name
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Brand
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                Unit Weight
              </th>
              <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                Unit Price
              </th>
              <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                Stock Quantity
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-sm text-gray-500">
                  No products found.
                </td>
              </tr>
            )}
            {filtered.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
