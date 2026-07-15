// "Original Transaction: X" / "Adjustment|Refund Transaction: Y" pair — shared
// by the Payment queue's Order Details panel and the Confirm Payment modal so
// the two order numbers can't drift or get swapped between the two views.
export function OriginalTransactionLink({ transaction }) {
  const isRefund = transaction.transaction_type === 'refund'
  const linkLabel = isRefund ? 'Refund Transaction' : 'Adjustment Transaction'

  return (
    <span className="flex flex-col gap-0.5">
      <span>Original Transaction: {transaction.parent_order_number}</span>
      <span>
        {linkLabel}: {transaction.order_number}
      </span>
    </span>
  )
}
