// Human-facing label for transaction_type_enum values. DB values are unchanged —
// this is display-only (e.g. 'refund' still means "store owes customer" in every
// query/filter; it just reads as "Credit Adjustment" in the UI).
export function getTransactionTypeLabel(transactionType) {
  switch (transactionType) {
    case 'original':
      return 'Original'
    case 'adjustment':
      return 'Adjustment'
    case 'refund':
      return 'Credit Adjustment'
    case 'balance_settlement':
      return 'Balance Settlement'
    default:
      return transactionType
  }
}
