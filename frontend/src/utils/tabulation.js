export function hasTabulationBreakdown(item) {
  return Array.isArray(item?.tabulation_breakdown) && item.tabulation_breakdown.length > 0
}

export function transactionHasTabulation(items) {
  return Array.isArray(items) && items.some(hasTabulationBreakdown)
}

export function buildTabulationLogsPageEntry(transaction) {
  return {
    id: `${transaction.id}-tabulation-logs`,
    __pageType: 'tabulation-logs',
    order_number: transaction.order_number,
    items: (transaction.items ?? []).filter(hasTabulationBreakdown),
  }
}
