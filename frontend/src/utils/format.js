export const formatCurrency = (amount) =>
  `₱${Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export function formatWeight(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toFixed(3)} kg`
}
