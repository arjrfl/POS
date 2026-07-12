import { QueueTransactionRow } from './QueueTransactionRow'

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-gray-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="w-16 h-16"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18l-1.5 11.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5L3 7Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a4 4 0 0 1 8 0v2" />
      </svg>
      <p className="mt-3 text-sm">No transactions in queue</p>
      <p className="text-sm">Transactions will appear here after payment is processed</p>
    </div>
  )
}

export function QueuePanel({ transactions, isLoading, onProcess }) {
  if (isLoading) {
    return <p className="px-4 text-gray-500">Loading queue...</p>
  }

  if (transactions.length === 0) {
    return <EmptyState />
  }

  // Parked transactions sink to the bottom of the list, visually distinct
  // (yellow accent) but otherwise part of the same flat list.
  const active = transactions.filter((t) => t.queue_status !== 'parked')
  const parked = transactions.filter((t) => t.queue_status === 'parked')
  const ordered = [...active, ...parked]

  return (
    <div>
      {ordered.map((transaction) => (
        <QueueTransactionRow key={transaction.id} transaction={transaction} onProcess={onProcess} />
      ))}
    </div>
  )
}
