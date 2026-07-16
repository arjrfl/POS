import { useState } from 'react'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

// Static mock rows for layout/scroll verification only — not from an API.
const MOCK_PRODUCTS = [
  { id: 1, product_name: 'Pork Belly', brand_name: 'Magnolia', unit_weight_kg: 1, unit_price: 320, stock_quantity: 45, status: 'active' },
  { id: 2, product_name: 'Pork Chop', brand_name: 'CDO', unit_weight_kg: 1, unit_price: 280, stock_quantity: 30, status: 'active' },
  { id: 3, product_name: 'Beef Brisket', brand_name: 'Purefoods', unit_weight_kg: 1, unit_price: 420, stock_quantity: 18, status: 'active' },
  { id: 4, product_name: 'Chicken Breast', brand_name: 'Swift', unit_weight_kg: 1, unit_price: 210, stock_quantity: 60, status: 'active' },
  { id: 5, product_name: 'Chicken Thigh', brand_name: 'Swift', unit_weight_kg: 1, unit_price: 190, stock_quantity: 52, status: 'active' },
  { id: 6, product_name: 'Ground Beef', brand_name: 'Monterey', unit_weight_kg: 1, unit_price: 350, stock_quantity: 25, status: 'active' },
  { id: 7, product_name: 'Pork Ribs', brand_name: 'CDO', unit_weight_kg: 1, unit_price: 300, stock_quantity: 22, status: 'active' },
  { id: 8, product_name: 'Chicken Wings', brand_name: 'San Miguel Foods', unit_weight_kg: 1, unit_price: 230, stock_quantity: 40, status: 'active' },
  { id: 9, product_name: 'Beef Cubes', brand_name: 'Purefoods', unit_weight_kg: 1, unit_price: 400, stock_quantity: 15, status: 'inactive' },
  { id: 10, product_name: 'Pork Liempo', brand_name: 'Magnolia', unit_weight_kg: 1, unit_price: 310, stock_quantity: 35, status: 'active' },
  { id: 11, product_name: 'Chicken Feet', brand_name: 'Swift', unit_weight_kg: 1, unit_price: 120, stock_quantity: 28, status: 'active' },
  { id: 12, product_name: 'Bangus', brand_name: 'Local Supplier', unit_weight_kg: 1, unit_price: 220, stock_quantity: 33, status: 'active' },
  { id: 13, product_name: 'Tilapia', brand_name: 'Local Supplier', unit_weight_kg: 1, unit_price: 150, stock_quantity: 50, status: 'active' },
  { id: 14, product_name: 'Squid', brand_name: 'Local Supplier', unit_weight_kg: 1, unit_price: 380, stock_quantity: 12, status: 'inactive' },
  { id: 15, product_name: 'Shrimp', brand_name: 'Local Supplier', unit_weight_kg: 1, unit_price: 450, stock_quantity: 10, status: 'active' },
  { id: 16, product_name: 'Beef Tapa', brand_name: 'Marca Piña', unit_weight_kg: 1, unit_price: 340, stock_quantity: 20, status: 'active' },
  { id: 17, product_name: 'Longganisa', brand_name: 'Tender Juicy', unit_weight_kg: 1, unit_price: 260, stock_quantity: 42, status: 'active' },
  { id: 18, product_name: 'Tocino', brand_name: 'Tender Juicy', unit_weight_kg: 1, unit_price: 270, stock_quantity: 38, status: 'active' },
  { id: 19, product_name: 'Hotdog', brand_name: 'CDO', unit_weight_kg: 1, unit_price: 180, stock_quantity: 55, status: 'active' },
  { id: 20, product_name: 'Bacon', brand_name: 'Purefoods', unit_weight_kg: 1, unit_price: 360, stock_quantity: 16, status: 'inactive' },
]

const ROW_GRID = 'grid grid-cols-[48px_1.5fr_1fr_0.8fr_0.9fr_0.7fr_0.9fr] gap-2 items-center'

function ProductRow({ product }) {
  return (
    <div className={`${ROW_GRID} px-4 py-3 border border-gray-200 rounded-md mb-1 bg-white`}>
      <span className="font-mono text-sm text-gray-500">{product.id}</span>
      <span className="font-medium text-gray-900">{product.product_name}</span>
      <span className="text-sm text-gray-600">{product.brand_name}</span>
      <span className="text-sm text-gray-700">{product.unit_weight_kg}kg</span>
      <span className="text-sm text-gray-700">{formatCurrency(product.unit_price)}</span>
      <span className="text-sm text-gray-700">{product.stock_quantity}</span>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize w-fit ${
          product.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
        }`}
      >
        {product.status}
      </span>
    </div>
  )
}

function FieldsPanel() {
  const [isActive, setIsActive] = useState(true)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4">
      <form className="flex flex-col gap-3">
        <Input label="Product Name" placeholder="e.g. Pork Belly" />
        <Input label="Brand Name" placeholder="e.g. Magnolia" />
        <Input label="Unit Weight (kg)" type="number" placeholder="1" />
        <Input label="Unit Price (₱/kg)" type="number" placeholder="0.00" />
        <Input label="Stock Quantity" type="number" placeholder="0" />

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Status</span>
          <div className="inline-flex rounded-full bg-gray-200 p-0.5 w-fit">
            {[
              { value: true, label: 'Active' },
              { value: false, label: 'Inactive' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setIsActive(option.value)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  isActive === option.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="primary" className="flex-1" disabled>
            Save
          </Button>
          <Button type="button" variant="outline" className="flex-1" disabled>
            Clear
          </Button>
        </div>
      </form>
    </div>
  )
}

export function InventoryView() {
  return (
    <div className="h-full flex gap-6 min-h-0">
      <div className="w-[300px] shrink-0 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Fields</span>
        <FieldsPanel />
      </div>

      <div className="flex-1 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Products</span>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg">
          <div className="sticky top-0 z-10 bg-gray-100 px-4 pt-4">
            <div className={`${ROW_GRID} pb-2 mb-2 border-b border-gray-300 text-xs font-semibold text-gray-600 uppercase tracking-wide`}>
              <span>ID</span>
              <span>Product Name</span>
              <span>Brand</span>
              <span>Unit Weight</span>
              <span>Unit Price</span>
              <span>Stock</span>
              <span>Status</span>
            </div>
          </div>
          <div className="px-4 pb-4">
            {MOCK_PRODUCTS.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
