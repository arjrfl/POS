// Display status for a transaction row — derived from the server-computed
// `payment_status` field (GET /transactions?...&include_payment_status=true),
// not from transaction_status. Shared by the Admin Transaction History tab
// and the Customer Details modal's Transaction History table so both render
// identical labels/colors for the same transaction.
const PAYMENT_STATUS_LABELS = {
  full: 'Fully paid',
  partial: 'Partially paid',
  voided: 'Voided',
}

export function getDisplayStatus(transaction) {
  const status = transaction?.payment_status ?? null
  return {
    status,
    label: PAYMENT_STATUS_LABELS[status] ?? null,
  }
}
