export const formatCurrency = (amount) =>
  `₱${Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export function formatWeight(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toFixed(3)} kg`
}

// Bare numeric rendering (no unit suffix, no fixed decimals — trailing zeros
// fall away naturally via Number()) — the convention Admin/Releasing's shared
// Inventory table (InventoryView.jsx) actually uses for its Stock column.
// Kept distinct from formatWeight (which is fixed-3-decimal + " kg") so any
// screen showing stock_quantity/unit_weight_kg alongside that same table's
// numbers renders identically to it.
export function formatStock(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value)}`
}
