import { ReceiverQueueCard } from './ReceiverQueueCard'

const TERMINAL_STATUSES = ['completed', 'voided']

export function QueuePanel({ transactions, isLoading, currentUserId, onEditOrder }) {
  if (isLoading) {
    return <p className="text-gray-500">Loading queue...</p>
  }

  const returned = transactions.filter((t) => t.transaction_status === 'pending_edit')
  // Anything already surfaced in "Returned for Editing" is left out here —
  // it's actionable up there, so showing it again as a read-only card too
  // would just be a confusing duplicate.
  const own = transactions.filter(
    (t) =>
      t.walkin_user_id === currentUserId &&
      t.transaction_status !== 'pending_edit' &&
      !TERMINAL_STATUSES.includes(t.transaction_status),
  )

  return (
    <div className="flex flex-col gap-6">
      {returned.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-yellow-800 uppercase tracking-wide bg-yellow-100 px-3 py-1.5 rounded-md mb-3">
            Returned for Editing
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {returned.map((transaction) => (
              <ReceiverQueueCard key={transaction.id} transaction={transaction} mode="returned" onEdit={onEditOrder} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">My Created Transactions</h3>
        {own.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No transactions created yet today</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {own.map((transaction) => (
              <ReceiverQueueCard key={transaction.id} transaction={transaction} mode="own" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
