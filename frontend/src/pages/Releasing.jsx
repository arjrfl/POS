import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { useReleasingQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/releasing/QueuePanel'
import { ReleaseProcessor } from '../components/releasing/ReleaseProcessor'
import { Card } from '../components/ui/Card'
import { post } from '../services/api'

export default function Releasing() {
  const { data, isLoading } = useReleasingQueue()
  const queryClient = useQueryClient()

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  const handleProcess = async (transaction) => {
    setStatusMessage(null)
    try {
      // A parked transaction isn't 'waiting', so /grab would reject it — /unpark
      // is the equivalent reclaim action for anything already parked.
      const endpoint = transaction.queue_status === 'parked' ? 'unpark' : 'grab'
      const grabbed = await post(`/transactions/${transaction.id}/${endpoint}`)
      setSelectedTransaction(grabbed)
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    }
  }

  const handleConfirmReady = async () => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/confirm-ready`)
      setSelectedTransaction(null)
      setStatusMessage('Transaction sent to Payment team')
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmWeights = async (items) => {
    setSubmitting(true)
    try {
      const confirmed = await post(`/transactions/${selectedTransaction.id}/confirm-weight`, { items })
      // Same transaction, now carrying actual_amount/balance_due — ReleaseProcessor
      // reacts to that and swaps the weight form for the substandard-resolution step.
      setSelectedTransaction(confirmed)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleResolve = async (outcome) => {
    setSubmitting(true)
    try {
      const resolved = await post(`/transactions/${selectedTransaction.id}/resolve`, { outcome })
      setSelectedTransaction(null)
      // A pay_now/refund_now outcome spins off a child pushed to Payment; every
      // other outcome (including both auto-resolve paths) finishes right here.
      setStatusMessage(resolved.children?.length > 0 ? 'Sent to Payment queue' : 'Transaction complete')
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageLayout title="Releasing Queue">
      {statusMessage && (
        <div className="mb-4 px-4 py-2 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-green-600 hover:text-green-800"
            aria-label="Dismiss"
          >
            &#10005;
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <QueuePanel transactions={data?.items ?? []} isLoading={isLoading} onProcess={handleProcess} />
        </Card>

        {selectedTransaction && (
          <ReleaseProcessor
            transaction={selectedTransaction}
            onConfirmReady={handleConfirmReady}
            onConfirmWeights={handleConfirmWeights}
            onResolve={handleResolve}
            submitting={submitting}
          />
        )}
      </div>
    </PageLayout>
  )
}
