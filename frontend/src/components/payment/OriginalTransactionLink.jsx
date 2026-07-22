import { getTransactionTypeLabel } from '../../utils/transactionType'

// "Original Transaction: X" / "Adjustment|Credit Adjustment Transaction: Y" pair —
// shared by the Payment queue's Order Details panel and the Confirm Payment modal
// so the two order numbers can't drift or get swapped between the two views.
export function OriginalTransactionLink({ transaction }) {
  const linkLabel = `${getTransactionTypeLabel(transaction.transaction_type)} Transaction`

  return (
    <span className="flex flex-col gap-0.5">
      <span>Original Transaction: {transaction.parent_order_number}</span>
      <span>
        {linkLabel}: {transaction.order_number}
      </span>
    </span>
  )
}
