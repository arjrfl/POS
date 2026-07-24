export function buildRangeQueryString(fromDate, toDate) {
  if (!fromDate || !toDate) return ''
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate })
  return `?${params.toString()}`
}
