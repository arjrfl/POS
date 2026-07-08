import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/currency'

export function ProductSelector({ onAddItem }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [unitCount, setUnitCount] = useState('')

  // Small, static catalog and the search endpoint only matches product_name —
  // fetch once and filter name/brand client-side instead of round-tripping per keystroke.
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => get('/products'),
  })

  const term = searchTerm.trim().toLowerCase()
  const filtered = term
    ? products?.filter(
        (p) => p.product_name.toLowerCase().includes(term) || p.brand_name?.toLowerCase().includes(term),
      )
    : products

  const handleSelect = (product) => {
    setSelectedProduct(product)
    setSearchTerm(product.product_name)
    setIsOpen(false)
    setUnitCount('1')
  }

  const unitWeight = selectedProduct?.unit_weight_kg != null ? Number(selectedProduct.unit_weight_kg) : null
  const unitPrice = selectedProduct ? Number(selectedProduct.unit_price_php) : 0
  const parsedCount = Number(unitCount)
  const qty = unitWeight != null ? unitWeight * (parsedCount || 0) : 0
  const total = unitPrice * qty

  const canAdd = selectedProduct && unitWeight != null && Number.isInteger(parsedCount) && parsedCount >= 1

  const handleAdd = () => {
    if (!canAdd) return
    onAddItem({
      item_type: 'product',
      product_id: selectedProduct.id,
      product_name: selectedProduct.product_name,
      brand_name: selectedProduct.brand_name,
      unit_weight_kg: unitWeight,
      unit_price: unitPrice,
      unit_count: parsedCount,
      qty,
      subtotal: total,
    })
    setSelectedProduct(null)
    setSearchTerm('')
    setUnitCount('')
  }

  return (
    <div>
      <div className="relative">
        <Input
          id="product-search"
          label="Product"
          placeholder="Search product by name or brand..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            setSelectedProduct(null)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          autoComplete="off"
        />

        {isOpen && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
            {filtered?.length ? (
              filtered.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  onMouseDown={() => handleSelect(product)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="font-medium text-gray-900">
                    {product.product_name}
                    {product.brand_name && <span className="text-gray-500 font-normal"> — {product.brand_name}</span>}
                  </div>
                  <div className="text-sm text-gray-500">
                    {product.unit_weight_kg && `${Number(product.unit_weight_kg)}kg · `}
                    {formatCurrency(product.unit_price_php)}/kg
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">No products found.</div>
            )}
          </div>
        )}
      </div>

      {selectedProduct && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <span className="text-sm font-medium text-gray-700">Product Name</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{selectedProduct.product_name}</div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700">Brand</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{selectedProduct.brand_name ?? '—'}</div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700">Unit Weight</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">
              {unitWeight != null ? `${unitWeight.toFixed(3)}kg` : '—'}
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700">Unit Price</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{formatCurrency(unitPrice)}</div>
          </div>

          <Input
            id="unit-count"
            label="Unit Count"
            type="number"
            step="1"
            min="1"
            value={unitCount}
            onChange={(e) => setUnitCount(e.target.value)}
          />
          <div>
            <span className="text-sm font-medium text-gray-700">QTY</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{qty.toFixed(3)}kg</div>
          </div>

          <div className="col-span-2">
            <span className="text-sm font-medium text-gray-700">Total</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900 font-semibold">{formatCurrency(total)}</div>
          </div>
        </div>
      )}

      <Button type="button" disabled={!canAdd} onClick={handleAdd} className="mt-3">
        Add Item
      </Button>
    </div>
  )
}
