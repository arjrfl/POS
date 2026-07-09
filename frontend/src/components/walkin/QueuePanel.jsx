import { ReceiverQueueRow } from './ReceiverQueueRow'

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-gray-500 italic">No orders returned for editing</p>
      <p className="mt-1 text-xs text-gray-400">Transactions returned from Payment will appear here</p>
    </div>
  )
}

export function QueuePanel({ transactions, isLoading, onEditOrder }) {
  if (isLoading) {
    return <p className="px-4 text-gray-500">Loading queue...</p>
  }

  if (transactions.length === 0) {
    return <EmptyState />
  }

  return (
    <div>
      {transactions.map((transaction) => (
        <ReceiverQueueRow key={transaction.id} transaction={transaction} onEdit={onEditOrder} />
      ))}
    </div>
  )
}
