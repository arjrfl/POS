import { useState } from 'react'
import { useProducts } from '../../hooks/useProducts'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency, formatStock, formatWeight } from '../../utils/format'

export function ProductStockPanel() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const { data: products, isLoading } = useProducts()

  const runSearch = () => setSearch(searchInput)

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
      <div className="flex-1 min-h-0 flex flex-col bg-gray-100 border border-brand-black/20 rounded-lg p-4">
        <div className="flex-shrink-0 mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-2">
          <div className="flex-1">
            <Input
              id="product-stock-search"
              placeholder="Search by Product name or Brand"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
            />
          </div>
          <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={runSearch}>
            Search
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-300">
                  <th className="w-[30%] py-2 px-2">Product Name</th>
                  <th className="w-[18%] py-2 px-2">Brand</th>
                  <th className="w-[16%] py-2 px-2">Unit Weight</th>
                  <th className="w-[18%] py-2 px-2">Unit Price</th>
                  <th className="w-[18%] py-2 px-2">Stock</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-gray-400 italic">
                      No products found
                    </td>
                  </tr>
                ) : (
                  filtered.map((product) => {
                    const outOfStock = Number(product.stock_quantity) === 0
                    return (
                      <tr key={product.id} className="border-b border-gray-200 last:border-b-0">
                        <td className="py-2 px-2 align-top font-semibold text-gray-900">{product.product_name}</td>
                        <td className="py-2 px-2 align-top text-gray-500">{product.brand_name}</td>
                        <td className="py-2 px-2 align-top text-gray-700">{formatWeight(product.unit_weight_kg)}</td>
                        <td className="py-2 px-2 align-top text-gray-700">{formatCurrency(product.unit_price_php)}</td>
                        <td className={`py-2 px-2 align-top ${outOfStock ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                          {formatStock(product.stock_quantity)}
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
    </div>
  )
}
