import { QueueTransactionCard } from './QueueTransactionCard'

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="w-16 h-16"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"
        />
      </svg>
      <p className="mt-3 text-sm font-medium text-gray-500">No transactions in queue</p>
      <p className="mt-1 text-xs text-gray-400">Transactions will appear here when receivers submit orders</p>
    </div>
  )
}

export function QueuePanel({ transactions, isLoading, onProcess }) {
  if (isLoading) {
    return <p className="text-gray-500">Loading queue...</p>
  }

  if (transactions.length === 0) {
    return <EmptyState />
  }

  // Parked transactions sink to the bottom of the list, visually distinct
  // (yellow left border) but otherwise part of the same flat list.
  const active = transactions.filter((t) => t.queue_status !== 'parked')
  const parked = transactions.filter((t) => t.queue_status === 'parked')
  const ordered = [...active, ...parked]

  return (
    <div className="flex flex-col gap-3">
      {ordered.map((transaction) => (
        <QueueTransactionCard key={transaction.id} transaction={transaction} onProcess={onProcess} />
      ))}
    </div>
  )
}
