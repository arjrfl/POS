import { useProducts } from '../../hooks/useProducts'
import { formatStock } from '../../utils/format'

// Read-only glance-reference for the Create Transaction modal — no search of
// its own (Column 2's Product field already covers that), no click handlers,
// no Action column. Calls useProducts() the same way ProductStockPanel does,
// so it shares that hook's React Query cache entry (same queryKey, no second
// fetch) and its product_changed listener (already wired to the single
// /ws/receiver connection mounted in PageLayout) — live stock updates land
// here for free, no separate subscription needed.
export function ProductReferenceTable() {
  const { data: products, isLoading } = useProducts()

  return (
    <div className="h-full flex flex-col min-h-0">
      <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Product Reference</span>
      <div className="flex-1 min-h-0 flex flex-col bg-gray-100 border border-gray-400 rounded-lg p-4">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-gray-100">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-300">
                <th className="w-[45%] py-2 px-2">Product Name</th>
                <th className="w-[30%] py-2 px-2">Brand</th>
                <th className="w-[25%] py-2 px-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : !products?.length ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400 italic">
                    No products found
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const outOfStock = Number(product.stock_quantity) === 0
                  return (
                    <tr key={product.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="py-2 px-2 align-top font-semibold text-gray-900">{product.product_name}</td>
                      <td className="py-2 px-2 align-top text-gray-500">{product.brand_name}</td>
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
  )
}
