import { QueueTransactionCard } from './QueueTransactionCard'

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18l-1.5 11.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5L3 7Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a4 4 0 0 1 8 0v2" />
      </svg>
      <p className="mt-3 text-sm">No transactions in queue</p>
    </div>
  )
}

export function QueuePanel({ transactions, isLoading, onProcess }) {
  if (isLoading) {
    return <p className="text-gray-500">Loading queue...</p>
  }

  const waiting = transactions.filter((t) => t.queue_status === 'waiting')
  const parked = transactions.filter((t) => t.queue_status === 'parked')

  if (waiting.length === 0 && parked.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-col gap-3">
      {waiting.map((transaction) => (
        <QueueTransactionCard key={transaction.id} transaction={transaction} onProcess={onProcess} />
      ))}

      {parked.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200 pt-3 mt-1">
            Parked
          </h3>
          {parked.map((transaction) => (
            <QueueTransactionCard key={transaction.id} transaction={transaction} onProcess={onProcess} />
          ))}
        </>
      )}
    </div>
  )
}
