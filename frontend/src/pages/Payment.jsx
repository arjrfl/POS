import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { usePaymentQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/payment/QueuePanel'
import { TransactionDetailPanel } from '../components/payment/TransactionDetailPanel'
import { PaymentModal } from '../components/payment/PaymentModal'
import { Toast } from '../components/ui/Toast'
import { get, post } from '../services/api'

export default function Payment() {
  const { data, isLoading } = usePaymentQueue()
  const queryClient = useQueryClient()

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  // Covers the narrow race window before FIX 4's disconnect-triggered release
  // finishes: if this same user still holds a transaction from just before
  // the reload, restore it instead of losing the in-progress work silently.
  useEffect(() => {
    get('/transactions?status=pending_payment&processing_by=me')
      .then((result) => {
        const mine = result?.items?.[0]
        if (mine) setSelectedTransaction(mine)
      })
      .catch(() => {})
  }, [])

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
      if (grabbed.payment_drafts?.length > 0) {
        showToast('Previous payment entries restored', 'success')
        setPayModalOpen(true)
      }
    } catch (err) {
      showToast(
        err.status === 409 ? 'This transaction is already being processed by another team member' : err.message,
        'error',
      )
    }
  }

  const handlePark = async () => {
    try {
      await post(`/transactions/${selectedTransaction.id}/park`)
      setSelectedTransaction(null)
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handleParkedFromModal = () => {
    setPayModalOpen(false)
    setSelectedTransaction(null)
    refreshQueue()
    showToast('Transaction parked with payment entries saved', 'success')
  }

  const handleReturnToReceiver = async () => {
    try {
      await post(`/transactions/${selectedTransaction.id}/return-to-receiver`)
      setSelectedTransaction(null)
      refreshQueue()
      showToast('Order returned to Receiver team', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handlePaid = () => {
    setPayModalOpen(false)
    setSelectedTransaction(null)
    refreshQueue()
  }

  return (
    <PageLayout title="Payment Queue">
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
                Finish or park the current transaction before processing another.
              </div>
            )}
            <QueuePanel transactions={data?.items ?? []} isLoading={isLoading} onProcess={handleProcess} />
          </div>
        </div>

        <div className="flex-[40] h-full min-h-0 flex flex-col">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Order Details</span>
          <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg p-3">
            <TransactionDetailPanel
              transaction={selectedTransaction}
              onPay={() => setPayModalOpen(true)}
              onPark={handlePark}
              onReturnToReceiver={handleReturnToReceiver}
            />
          </div>
        </div>
      </div>

      {selectedTransaction && (
        <PaymentModal
          open={payModalOpen}
          transaction={selectedTransaction}
          onClose={() => setPayModalOpen(false)}
          onPaid={handlePaid}
          onParked={handleParkedFromModal}
        />
      )}

      <Toast toast={toast} />
    </PageLayout>
  )
}
