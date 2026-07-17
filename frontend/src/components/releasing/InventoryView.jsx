import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, ArrowUpDown, Power } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { get, post, patch } from '../../services/api'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { AdjustStockModal } from './AdjustStockModal'
import { formatCurrency } from '../../utils/format'

const ROW_GRID = 'grid grid-cols-[48px_1.3fr_0.9fr_0.7fr_0.9fr_0.6fr_0.8fr_0.9fr] gap-2 items-center'

function emptyForm() {
  return { product_name: '', brand_name: '', unit_weight_kg: '', unit_price_php: '', stock_quantity: '0' }
}

function formFor(product) {
  if (!product) return emptyForm()
  return {
    product_name: product.product_name,
    brand_name: product.brand_name ?? '',
    unit_weight_kg: product.unit_weight_kg ?? '',
    unit_price_php: product.unit_price_php,
    stock_quantity: '0',
  }
}

function FieldsPanel({ editingProduct, onSaved, onClear }) {
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setForm(formFor(editingProduct))
    setFormError('')

    if (!editingProduct) {
      setHistory(null)
      return
    }

    let cancelled = false
    setHistoryLoading(true)
    get(`/products/${editingProduct.id}/history`)
      .then((logs) => {
        if (!cancelled) setHistory(logs)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editingProduct])

  const setField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const canSubmit =
    form.product_name.trim().length > 0 && form.unit_price_php !== '' && Number(form.unit_price_php) >= 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setFormError('')

    const basePayload = {
      product_name: form.product_name.trim(),
      brand_name: form.brand_name.trim() || null,
      unit_weight_kg: form.unit_weight_kg === '' ? null : Number(form.unit_weight_kg),
      unit_price_php: Number(form.unit_price_php),
    }

    try {
      if (editingProduct) {
        await patch(`/products/${editingProduct.id}`, basePayload)
        onSaved('Product updated')
      } else {
        await post('/products', {
          ...basePayload,
          stock_quantity: form.stock_quantity === '' ? 0 : Number(form.stock_quantity),
        })
        // editingProduct is already null in Add mode, so onSaved's setEditingProduct(null)
        // is a no-op and won't re-trigger the reset effect — clear the form directly.
        setForm(emptyForm())
        document.getElementById('field-product-name')?.focus()
        onSaved('Product added')
      }
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const lastUpdate = history?.[0]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-gray-700">
          {editingProduct ? `Editing #${editingProduct.id}` : 'Add New Product'}
        </p>

        <Input
          id="field-product-name"
          label="Product Name"
          placeholder="e.g. Pork Belly"
          value={form.product_name}
          onChange={setField('product_name')}
          required
        />
        <Input
          id="field-brand-name"
          label="Brand Name"
          placeholder="e.g. Magnolia"
          value={form.brand_name}
          onChange={setField('brand_name')}
        />
        <Input
          id="field-unit-weight"
          label="Unit Weight (kg)"
          type="number"
          step="0.001"
          min="0"
          placeholder="1"
          value={form.unit_weight_kg}
          onChange={setField('unit_weight_kg')}
        />
        <Input
          id="field-unit-price"
          label="Unit Price (₱/kg)"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={form.unit_price_php}
          onChange={setField('unit_price_php')}
          required
        />

        {!editingProduct && (
          <Input
            id="field-stock-quantity"
            label="Stock Quantity"
            type="number"
            step="0.001"
            min="0"
            placeholder="0"
            value={form.stock_quantity}
            onChange={setField('stock_quantity')}
          />
        )}

        {editingProduct && (
          <p className="text-xs text-gray-500">
            {historyLoading
              ? 'Loading history...'
              : lastUpdate
                ? `Last updated by ${lastUpdate.changed_by_full_name}, ${new Date(lastUpdate.changed_at).toLocaleString()}`
                : 'No changes yet'}
          </p>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="submit" variant="primary" className="flex-1" disabled={!canSubmit || submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onClear} disabled={submitting}>
            Clear
          </Button>
        </div>
      </form>
    </div>
  )
}

function ProductRow({ product, onEdit, onAdjustStock, confirmingToggle, togglingId, onToggleStatus, onConfirmToggle, onCancelToggle }) {
  if (confirmingToggle) {
    const willDeactivate = product.product_status === 'active'
    return (
      <div className="px-4 py-3 border border-yellow-300 bg-yellow-50 rounded-md mb-1 flex items-center justify-between gap-3">
        <span className="text-sm text-amber-800">
          {willDeactivate ? 'Deactivate' : 'Reactivate'} "{product.product_name}"?
        </span>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            className="!px-3 !py-1 text-xs"
            onClick={onCancelToggle}
            disabled={togglingId === product.id}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={willDeactivate ? 'danger' : 'success'}
            className="!px-3 !py-1 text-xs"
            onClick={() => onConfirmToggle(product)}
            disabled={togglingId === product.id}
          >
            {togglingId === product.id ? 'Saving...' : 'Yes'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${ROW_GRID} px-4 py-3 border border-gray-200 rounded-md mb-1 bg-white hover:bg-primary/5 hover:border-primary/30 transition-colors`}
    >
      <span className="font-mono text-sm text-gray-500">{product.id}</span>
      <span className="font-medium text-gray-900">{product.product_name}</span>
      <span className="text-sm text-gray-600">{product.brand_name ?? '—'}</span>
      <span className="text-sm text-gray-700">
        {product.unit_weight_kg != null ? `${Number(product.unit_weight_kg)}kg` : '—'}
      </span>
      <span className="text-sm text-gray-700">{formatCurrency(product.unit_price_php)}</span>
      <span className="text-sm text-gray-700">{Number(product.stock_quantity)}</span>
      <Badge status={product.product_status} />
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={() => onEdit(product)}
          className="p-1.5 rounded-md text-gray-500 hover:text-primary hover:bg-primary/10"
          aria-label={`Edit ${product.product_name}`}
          title="Edit"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          onClick={() => onAdjustStock(product)}
          className="p-1.5 rounded-md text-gray-500 hover:text-primary hover:bg-primary/10"
          aria-label={`Adjust stock for ${product.product_name}`}
          title="Adjust Stock"
        >
          <ArrowUpDown size={16} />
        </button>
        <button
          type="button"
          onClick={() => onToggleStatus(product)}
          className={`p-1.5 rounded-md hover:bg-gray-100 ${
            product.product_status === 'active' ? 'text-green-600' : 'text-gray-400'
          }`}
          aria-label={`Toggle status for ${product.product_name}`}
          title="Toggle Status"
        >
          <Power size={16} />
        </button>
      </div>
    </div>
  )
}

export function InventoryView({ showToast }) {
  const [editingProduct, setEditingProduct] = useState(null)
  const [adjustingProduct, setAdjustingProduct] = useState(null)
  const [confirmingToggleId, setConfirmingToggleId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')

  const { data: products, isLoading } = useProducts(committedSearch)
  const queryClient = useQueryClient()

  const runSearch = () => setCommittedSearch(searchQuery.trim())

  const refreshProducts = () => queryClient.invalidateQueries({ queryKey: ['products'] })

  const handleSaved = (message) => {
    setEditingProduct(null)
    showToast?.(message, 'success')
    refreshProducts()
  }

  const handleAdjustStockConfirm = async (id, payload) => {
    await post(`/products/${id}/adjust-stock`, payload)
    showToast?.('Stock updated', 'success')
    refreshProducts()
  }

  const handleConfirmToggle = async (product) => {
    setTogglingId(product.id)
    try {
      await post(`/products/${product.id}/toggle-status`)
      showToast?.(product.product_status === 'active' ? 'Product deactivated' : 'Product reactivated', 'success')
      setConfirmingToggleId(null)
      refreshProducts()
    } catch (err) {
      showToast?.(err.message, 'error')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="h-full flex gap-6 min-h-0">
      <div className="w-[300px] shrink-0 h-full min-h-0 flex flex-col">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Fields</span>
        <FieldsPanel
          editingProduct={editingProduct}
          onSaved={handleSaved}
          onClear={() => setEditingProduct(null)}
        />
      </div>

      <div className="flex-1 h-full min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Products</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
            />
            <Button type="button" variant="primary" className="!px-4 !py-1.5 text-sm" onClick={runSearch}>
              Search
            </Button>
          </div>
        </div>
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
              <span className="text-right">Action</span>
            </div>
          </div>
          <div className="px-4 pb-4">
            {isLoading && <p className="text-sm text-gray-500 py-4">Loading...</p>}
            {!isLoading && products?.length === 0 && <p className="text-sm text-gray-500 py-4">No products found.</p>}
            {products?.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                onEdit={setEditingProduct}
                onAdjustStock={setAdjustingProduct}
                confirmingToggle={confirmingToggleId === product.id}
                togglingId={togglingId}
                onToggleStatus={(p) => setConfirmingToggleId(p.id)}
                onConfirmToggle={handleConfirmToggle}
                onCancelToggle={() => setConfirmingToggleId(null)}
              />
            ))}
          </div>
        </div>
      </div>

      <AdjustStockModal
        open={!!adjustingProduct}
        product={adjustingProduct}
        onClose={() => setAdjustingProduct(null)}
        onConfirm={handleAdjustStockConfirm}
      />
    </div>
  )
}
