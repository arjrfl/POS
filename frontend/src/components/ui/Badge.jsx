// Status values come from transaction_status_enum and queue_status_enum in database/schema.sql
const STATUS_STYLES = {
  pending_payment: 'bg-yellow-100 text-yellow-800',
  pending_settlement: 'bg-blue-100 text-blue-800',
  settled: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  voided: 'bg-red-100 text-red-800',

  waiting: 'bg-gray-100 text-gray-700',
  processing: 'bg-blue-100 text-blue-800',
  parked: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-800',

  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-200 text-gray-600',

  // payment_status — UI-derived (not its own DB enum), computed per-transaction
  // from get_outstanding_balance_entries. voided reuses the transaction_status
  // style above since the value is literally "voided" in both cases. pending
  // reuses the same neutral tone as queue_status "waiting" above.
  full: 'bg-green-100 text-green-800',
  partial: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-gray-100 text-gray-700',
}

export function Badge({ status, children, className = '' }) {
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-700'

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${style} ${className}`}
    >
      {children ?? status?.replace(/_/g, ' ')}
    </span>
  )
}
