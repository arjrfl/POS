import { useState } from 'react'
import { useProducts } from '../../hooks/useProducts'
import { Input } from '../ui/Input'
import { formatCurrency, formatWeight } from '../../utils/format'

export function ProductStockPanel() {
  const [search, setSearch] = useState('')
  const { data: products, isLoading } = useProducts()

  const term = search.trim().toLowerCase()
  const filtered = term
    ? (products ?? []).filter(
        (product) =>
          product.product_name?.toLowerCase().includes(term) || product.brand_name?.toLowerCase().includes(term),
      )
    : products ?? []

  return (
    <div className="h-full flex flex-col min-h-0">
      <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Product Stock</span>
      <div className="flex-1 min-h-0 flex flex-col bg-gray-100 border border-gray-400 rounded-lg p-4">
        <div className="flex-shrink-0 mb-3">
          <Input
            id="product-stock-search"
            placeholder="Search by article or brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-gray-100">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-300">
                <th className="w-1/2 py-2 px-2">Articles</th>
                <th className="w-1/4 py-2 px-2">Unit Price</th>
                <th className="w-1/4 py-2 px-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400 italic">
                    No products found
                  </td>
                </tr>
              ) : (
                filtered.map((product) => {
                  const outOfStock = Number(product.stock_quantity) === 0
                  return (
                    <tr key={product.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="py-2 px-2 align-top">
                        <div className="font-semibold text-gray-900">{product.product_name}</div>
                        {product.brand_name && <div className="text-xs text-gray-500">{product.brand_name}</div>}
                      </td>
                      <td className="py-2 px-2 align-top text-gray-700">{formatCurrency(product.unit_price_php)}</td>
                      <td className={`py-2 px-2 align-top ${outOfStock ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                        {formatWeight(product.stock_quantity)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
