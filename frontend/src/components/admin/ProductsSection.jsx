import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProducts } from '../../hooks/useProducts'
import { post, patch, del } from '../../services/api'
import { ProductFormModal } from './ProductFormModal'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

export function ProductsSection() {
  const [search, setSearch] = useState('')
  const [editingProduct, setEditingProduct] = useState(undefined) // undefined = closed, null = add, object = edit
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const { data: products, isLoading } = useProducts(search)
  const queryClient = useQueryClient()

  const refreshProducts = () => queryClient.invalidateQueries({ queryKey: ['products'] })

  const handleSubmit = async (payload) => {
    setSubmitting(true)
    setFormError('')
    try {
      if (editingProduct) {
        await patch(`/products/${editingProduct.id}`, payload)
      } else {
        await post('/products', payload)
      }
      setEditingProduct(undefined)
      refreshProducts()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (product) => {
    if (!window.confirm(`Deactivate "${product.product_name}"? It will no longer appear for new orders.`)) return
    try {
      await del(`/products/${product.id}`)
      refreshProducts()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1 max-w-sm">
          <Input
            id="product-list-search"
            label="Search products"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="button" onClick={() => setEditingProduct(null)}>
          + Add Product
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {!isLoading && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2 text-right">Unit Weight</th>
                <th className="px-3 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {products?.map((product) => (
                <tr key={product.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-2 text-sm font-medium text-gray-900">{product.product_name}</td>
                  <td className="px-3 py-2 text-sm text-gray-600">{product.brand_name ?? '—'}</td>
                  <td className="px-3 py-2 text-sm text-right text-gray-700">
                    {product.unit_weight_kg != null ? `${Number(product.unit_weight_kg)}kg` : '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-right text-gray-900">{formatCurrency(product.unit_price_php)}</td>
                  <td className="px-3 py-2 text-sm text-right text-gray-700">{Number(product.stock_quantity)}</td>
                  <td className="px-3 py-2">
                    <Badge status={product.product_status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 justify-end">
                      <Button type="button" variant="secondary" onClick={() => setEditingProduct(product)}>
                        Edit
                      </Button>
                      <Button type="button" variant="danger" onClick={() => handleDelete(product)}>
                        Deactivate
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {products?.length === 0 && <p className="text-gray-500 text-sm py-4">No products found.</p>}
        </div>
      )}

      <ProductFormModal
        open={editingProduct !== undefined}
        product={editingProduct}
        onClose={() => {
          setEditingProduct(undefined)
          setFormError('')
        }}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={formError}
      />
    </Card>
  )
}
