import { useEffect, useState } from 'react'
import { QueueTransactionRow } from './QueueTransactionRow'

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-sm text-gray-400 italic">No transactions in queue</p>
    </div>
  )
}

export function QueuePanel({ transactions, isLoading, onProcess }) {
  // Drives the stale-parked (>3h) highlight re-check — purely a visual tick,
  // no data refetch/WebSocket invalidation involved.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(interval)
  }, [])

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
        <QueueTransactionRow key={transaction.id} transaction={transaction} onProcess={onProcess} now={now} />
      ))}
    </div>
  )
}
