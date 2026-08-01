import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { TabulationModal } from './TabulationModal'
import { formatCurrency, formatWeight, formatStock } from '../../utils/format'

// enableTabulation defaults off — the Tabulation button/modal is Receiver-only
// (see CreateTransactionModal.jsx). Payment's Add New Item (EditItemsModal.jsx)
// reuses this same component but omits the prop, so it stays unaffected.
export function ProductSelector({
  onAddItem,
  editingItem = null,
  onUpdateItem,
  onCancelEdit,
  enableTabulation = false,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [estimatedWeight, setEstimatedWeight] = useState('')
  const [unitCount, setUnitCount] = useState('')
  const [qty, setQty] = useState('')
  const [itemError, setItemError] = useState('')
  // Per-unit weight breakdown from the Tabulation modal — null when this
  // pending line was never tabulated, or was invalidated by a manual QTY/
  // Unit Count edit since the last Tabulation confirm (see handleQtyChange/
  // handleUnitCountChange below).
  const [tabulationBreakdown, setTabulationBreakdown] = useState(null)
  const [tabulationOpen, setTabulationOpen] = useState(false)

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

  const resetItemFields = () => {
    setEstimatedWeight('')
    setUnitCount('')
    setQty('')
    setItemError('')
    setTabulationBreakdown(null)
  }

  // Mirrors the row being edited (or clears back to blank/Add state) into this
  // component's own local fields. Only reruns when the parent hands us a
  // different row (a new pencil click, a save, a cancel, or a delete of the
  // row mid-edit) — never while the user is actively typing within one edit.
  useEffect(() => {
    if (editingItem) {
      const product = products?.find((p) => p.id === editingItem.product_id) ?? {
        id: editingItem.product_id,
        product_name: editingItem.product_name,
        brand_name: editingItem.brand_name,
        unit_price_php: editingItem.unit_price,
        unit_weight_kg: null,
        stock_quantity: Infinity,
      }
      setSelectedProduct(product)
      setSearchTerm('')
      setIsOpen(false)
      setEstimatedWeight(editingItem.estimated_weight_kg != null ? String(editingItem.estimated_weight_kg) : '')
      setUnitCount(editingItem.unit_count != null ? String(editingItem.unit_count) : '')
      setQty(editingItem.quantity_kg != null ? String(editingItem.quantity_kg) : '')
      setItemError('')
      setTabulationBreakdown(Array.isArray(editingItem.tabulation_breakdown) ? editingItem.tabulation_breakdown : null)
    } else {
      setSelectedProduct(null)
      setSearchTerm('')
      setIsOpen(false)
      resetItemFields()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingItem])

  const handleSelect = (product) => {
    setSelectedProduct(product)
    setSearchTerm('')
    setIsOpen(false)
    setEstimatedWeight(product.unit_weight_kg != null ? String(product.unit_weight_kg) : '')
    setUnitCount('')
    setQty('')
    setItemError('')
    setTabulationBreakdown(null)
  }

  const handleDeselect = () => {
    setSelectedProduct(null)
    resetItemFields()
  }

  const unitPrice = selectedProduct ? Number(selectedProduct.unit_price_php) : 0

  // "Last touched wins" — whichever of Estimated Weight / Unit Count the user
  // edited most recently recomputes QTY as weight * count. If the other field
  // is still empty/0 (not yet entered), QTY falls back to the raw new value
  // instead of multiplying to zero. QTY itself is always freely editable and
  // never re-derived once the user types into it directly.
  const multiplyKg = (weight, count) => Math.round(weight * count * 1000) / 1000

  const handleWeightChange = (value) => {
    setEstimatedWeight(value)
    const count = unitCount === '' ? 0 : Number(unitCount)
    setQty(value === '' || !count ? value : String(multiplyKg(Number(value), count)))
  }

  const handleUnitCountChange = (value) => {
    setUnitCount(value)
    const weight = estimatedWeight === '' ? 0 : Number(estimatedWeight)
    setQty(value === '' || !weight ? value : String(multiplyKg(weight, Number(value))))
    // Row count would no longer match the new Unit Count — clear rather than
    // keep a stale breakdown. QTY itself is left exactly as computed above,
    // not re-derived from the (now cleared) breakdown.
    setTabulationBreakdown(null)
  }

  const handleQtyChange = (value) => {
    setQty(value)
    // Manual QTY edit no longer matches whatever breakdown produced the old
    // value — clear it. QTY is left as whatever the user typed.
    setTabulationBreakdown(null)
  }

  const handleTabulationConfirm = (values, total) => {
    setQty(String(total))
    setTabulationBreakdown(values)
    setTabulationOpen(false)
  }

  const parsedUnitCount = unitCount === '' ? null : Number(unitCount)
  const unitCountValid = parsedUnitCount != null && Number.isInteger(parsedUnitCount) && parsedUnitCount > 0
  const parsedQty = qty === '' ? null : Number(qty)
  const parsedWeight = estimatedWeight === '' ? null : Number(estimatedWeight)
  const subtotal = (parsedQty || 0) * unitPrice

  const stockAvailable = selectedProduct ? Number(selectedProduct.stock_quantity) : null
  const exceedsStock = selectedProduct && parsedQty != null && parsedQty > stockAvailable

  const buildItemPayload = () => {
    if (!parsedUnitCount || parsedUnitCount <= 0) {
      setItemError('Unit count is required')
      return null
    }
    if (!parsedQty || parsedQty <= 0) {
      setItemError('QTY is required')
      return null
    }
    if (exceedsStock) {
      setItemError(`Only ${formatStock(stockAvailable)} kg left in stock`)
      return null
    }

    return {
      item_type: 'product',
      product_id: selectedProduct.id,
      product_name: selectedProduct.product_name,
      brand_name: selectedProduct.brand_name,
      estimated_weight_kg: parsedWeight,
      unit_price: unitPrice,
      unit_count: parsedUnitCount,
      quantity_kg: parsedQty,
      tabulation_breakdown: tabulationBreakdown,
      subtotal,
    }
  }

  const handleAdd = () => {
    const payload = buildItemPayload()
    if (!payload) return

    onAddItem(payload)
    setSelectedProduct(null)
    setSearchTerm('')
    resetItemFields()
  }

  const handleUpdate = () => {
    const payload = buildItemPayload()
    if (!payload) return

    onUpdateItem(editingItem.id, payload)
  }

  const handleCancel = () => {
    onCancelEdit()
  }

  return (
    <div>
      {!selectedProduct && (
        <div className="relative">
          <Input
            id="product-search"
            label="Product"
            placeholder="Search product by name or brand..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
            autoComplete="off"
          />

          {isOpen && (
            <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
              {filtered?.length ? (
                filtered.map((product) => {
                  const isUnpriced = Number(product.unit_price_php) === 0
                  return (
                    <button
                      type="button"
                      key={product.id}
                      onMouseDown={() => !isUnpriced && handleSelect(product)}
                      disabled={isUnpriced}
                      className={`w-full text-left px-3 py-2 border-b border-gray-100 last:border-b-0 ${
                        isUnpriced ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="font-medium text-gray-900">
                        {product.product_name}
                        {product.brand_name && (
                          <span className="text-gray-500 font-normal"> — {product.brand_name}</span>
                        )}
                        {isUnpriced && (
                          <span className="ml-2 text-xs text-gray-400 italic font-normal">Awaiting price</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {product.unit_weight_kg && `${formatWeight(product.unit_weight_kg)} · `}
                        {isUnpriced ? 'No price set' : `${formatCurrency(product.unit_price_php)}/kg`}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500">No products found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {selectedProduct && (
        <div className="flex flex-col gap-3">
          <div>
            <span className="text-sm font-medium text-gray-700">Product</span>
            <div className="mt-1">
              <span className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                {selectedProduct.product_name}
                {selectedProduct.brand_name && (
                  <span className="text-primary/70 font-normal"> — {selectedProduct.brand_name}</span>
                )}
                <button
                  type="button"
                  onClick={handleDeselect}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-primary/20"
                  aria-label="Deselect product"
                >
                  &#10005;
                </button>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="estimated-weight"
              label="Estimated Weight (kg)"
              type="number"
              step="0.001"
              placeholder="0.000"
              value={estimatedWeight}
              onChange={(e) => handleWeightChange(e.target.value)}
            />
            <div>
              <span className="text-sm font-medium text-gray-700">Unit Price</span>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900">{formatCurrency(unitPrice)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="unit-count"
              label="Unit Count"
              type="number"
              step="1"
              placeholder="0"
              value={unitCount}
              onChange={(e) => handleUnitCountChange(e.target.value)}
            />
            <Input
              id="qty"
              label={
                <>
                  QTY (kg)
                  {enableTabulation && tabulationBreakdown && (
                    <span className="ml-1.5 text-xs font-normal text-brand-gold-dark">Tabulated</span>
                  )}
                </>
              }
              type="number"
              step="0.001"
              placeholder="0.000"
              value={qty}
              onChange={(e) => handleQtyChange(e.target.value)}
            />
          </div>

          {enableTabulation && (
            <div className="grid grid-cols-2 gap-3">
              <div />
              <Button
                type="button"
                variant="outline"
                onClick={() => setTabulationOpen(true)}
                disabled={!unitCountValid}
              >
                Tabulation
              </Button>
            </div>
          )}

          {exceedsStock && <p className="text-sm text-red-600">Only {formatStock(stockAvailable)} kg left in stock</p>}

          <div>
            <span className="text-sm font-medium text-gray-700">Subtotal</span>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-gray-900 font-semibold">
              {formatCurrency(subtotal)}
            </div>
          </div>

          {itemError && <p className="text-sm text-red-600">{itemError}</p>}

          {editingItem ? (
            <div className="flex gap-2">
              <Button type="button" onClick={handleUpdate} className="flex-1" disabled={exceedsStock}>
                Update Item
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel} className="flex-1">
                Cancel
              </Button>
            </div>
          ) : (
            <Button type="button" onClick={handleAdd} className="w-full" disabled={exceedsStock}>
              + Add to Order
            </Button>
          )}
        </div>
      )}

      {enableTabulation && (
        <TabulationModal
          open={tabulationOpen}
          unitCount={unitCountValid ? parsedUnitCount : 0}
          initialValues={tabulationBreakdown}
          onConfirm={handleTabulationConfirm}
          onClose={() => setTabulationOpen(false)}
        />
      )}
    </div>
  )
}
