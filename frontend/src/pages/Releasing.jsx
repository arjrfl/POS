import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { useReleasingQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/releasing/QueuePanel'
import { ReleaseProcessor } from '../components/releasing/ReleaseProcessor'
import { HandoverOutcomeModal } from '../components/releasing/HandoverOutcomeModal'
import { Toast } from '../components/ui/Toast'
import { get, post } from '../services/api'

export default function Releasing() {
  const { data, isLoading } = useReleasingQueue()
  const queryClient = useQueryClient()

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  const [reviewTransaction, setReviewTransaction] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [outcomeLoading, setOutcomeLoading] = useState(false)
  const [confirmingHandover, setConfirmingHandover] = useState(false)

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  const showToast = (message, variant = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, variant })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  const handleProcess = async (transaction) => {
    try {
      // A parked transaction isn't 'waiting', so /grab would reject it — /unpark
      // is the equivalent reclaim action for anything already parked.
      const endpoint = transaction.queue_status === 'parked' ? 'unpark' : 'grab'
      const grabbed = await post(`/transactions/${transaction.id}/${endpoint}`)
      setSelectedTransaction(grabbed)
      refreshQueue()
    } catch (err) {
      showToast(
        err.status === 409 ? 'This transaction is already being processed by another team member' : err.message,
        'error',
      )
    }
  }

  const handleConfirmReady = async () => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/confirm-ready`)
      setSelectedTransaction(null)
      showToast('Order sent to Payment team', 'success')
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
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
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // 'send_to_payment' is the only outcome the backend accepts, and only for a
  // transaction with an actual variance — Releasing makes no financial decision,
  // just hands the weight difference to Payment.
  const handleResolve = async (successMessage) => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/resolve`, { outcome: 'send_to_payment' })
      setSelectedTransaction(null)
      showToast(successMessage, 'success')
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Walk-in exact weight — Releasing's own explicit action now, no longer an
  // automatic side effect of confirming the last item.
  const handleCompleteExact = async () => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/complete-exact`)
      setSelectedTransaction(null)
      showToast('Transaction complete', 'success')
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // 'settled' cards need no grab/lock — just a quick review of what Payment
  // did, then a single confirm that hands the item over and drops stock.
  const handleReview = async (transaction) => {
    setReviewTransaction(transaction)
    setOutcome(null)
    setOutcomeLoading(true)
    try {
      const result = await get(`/transactions/${transaction.id}/handover-outcome`)
      setOutcome(result)
    } catch (err) {
      showToast(err.message, 'error')
      setReviewTransaction(null)
    } finally {
      setOutcomeLoading(false)
    }
  }

  const handleCloseReview = () => {
    setReviewTransaction(null)
    setOutcome(null)
  }

  const handleConfirmHandover = async () => {
    setConfirmingHandover(true)
    try {
      await post(`/transactions/${reviewTransaction.id}/confirm-handover`)
      setReviewTransaction(null)
      setOutcome(null)
      showToast('Transaction complete', 'success')
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setConfirmingHandover(false)
    }
  }

  return (
    <PageLayout title="Releasing Queue">
      <div className="h-full flex gap-6 min-h-0">
        <div className="flex-[60] h-full min-h-0 flex flex-col">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Queue</span>
          <div
            className={`flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4 ${
              selectedTransaction ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            {selectedTransaction && (
              <div className="mb-3 px-3 py-2 rounded-md bg-yellow-100 text-sm text-amber-800">
                Finish the current transaction before processing another.
              </div>
            )}
            <QueuePanel
              transactions={data?.items ?? []}
              isLoading={isLoading}
              onProcess={handleProcess}
              onReview={handleReview}
            />
          </div>
        </div>

        <div className="flex-[40] h-full min-h-0 flex flex-col">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Order Details</span>
          <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg p-3 flex flex-col">
            <ReleaseProcessor
              key={selectedTransaction?.id ?? 'empty'}
              transaction={selectedTransaction}
              onConfirmReady={handleConfirmReady}
              onConfirmWeights={handleConfirmWeights}
              onResolve={handleResolve}
              onCompleteExact={handleCompleteExact}
              submitting={submitting}
            />
          </div>
        </div>
      </div>

      <HandoverOutcomeModal
        open={!!reviewTransaction}
        transaction={reviewTransaction}
        outcome={outcome}
        loading={outcomeLoading}
        submitting={confirmingHandover}
        onClose={handleCloseReview}
        onConfirm={handleConfirmHandover}
      />

      <Toast toast={toast} />
    </PageLayout>
  )
}
