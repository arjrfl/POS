import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

function emptyForm() {
  return { product_name: '', brand_name: '', unit_weight_kg: '', unit_price_php: '', stock_quantity: '' }
}

function formFor(product) {
  if (!product) return emptyForm()
  return {
    product_name: product.product_name,
    brand_name: product.brand_name ?? '',
    unit_weight_kg: product.unit_weight_kg ?? '',
    unit_price_php: product.unit_price_php,
    stock_quantity: product.stock_quantity,
  }
}

export function ProductFormModal({ open, product, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    if (open) setForm(formFor(product))
  }, [open, product])

  const setField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const canSubmit =
    form.product_name.trim().length > 0 &&
    form.unit_price_php !== '' &&
    Number(form.unit_price_php) >= 0 &&
    form.stock_quantity !== '' &&
    Number(form.stock_quantity) >= 0

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      product_name: form.product_name.trim(),
      brand_name: form.brand_name.trim() || null,
      unit_weight_kg: form.unit_weight_kg === '' ? null : Number(form.unit_weight_kg),
      unit_price_php: Number(form.unit_price_php),
      stock_quantity: Number(form.stock_quantity),
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Edit Product' : 'Add Product'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input id="product-name" label="Product name" value={form.product_name} onChange={setField('product_name')} required />
        <Input id="product-brand" label="Brand (optional)" value={form.brand_name} onChange={setField('brand_name')} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            id="product-unit-weight"
            label="Unit weight (kg)"
            type="number"
            step="0.001"
            min="0"
            value={form.unit_weight_kg}
            onChange={setField('unit_weight_kg')}
          />
          <Input
            id="product-price"
            label="Unit price (₱/kg)"
            type="number"
            step="0.01"
            min="0"
            value={form.unit_price_php}
            onChange={setField('unit_price_php')}
            required
          />
        </div>
        <Input
          id="product-stock"
          label="Stock quantity"
          type="number"
          step="0.001"
          min="0"
          value={form.stock_quantity}
          onChange={setField('stock_quantity')}
          required
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={submitting || !canSubmit}>
            {submitting ? 'Saving...' : product ? 'Save Changes' : 'Add Product'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
