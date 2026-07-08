import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { usePaymentQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/payment/QueuePanel'
import { TransactionDetailPanel } from '../components/payment/TransactionDetailPanel'
import { PaymentModal } from '../components/payment/PaymentModal'
import { Toast } from '../components/ui/Toast'
import { post } from '../services/api'

export default function Payment() {
  const { data, isLoading } = usePaymentQueue()
  const queryClient = useQueryClient()

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

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

  const handlePark = async () => {
    try {
      await post(`/transactions/${selectedTransaction.id}/park`)
      setSelectedTransaction(null)
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    }
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
        <div className="flex-[55] h-full min-h-0 flex flex-col">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Queue</span>
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4">
            <QueuePanel transactions={data?.items ?? []} isLoading={isLoading} onProcess={handleProcess} />
          </div>
        </div>

        <div className="flex-[45] h-full min-h-0 flex flex-col">
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Order Details</span>
          <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg p-4">
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
        />
      )}

      <Toast toast={toast} />
    </PageLayout>
  )
}
