import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { usePaymentQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/payment/QueuePanel'
import { TransactionDetailPanel } from '../components/payment/TransactionDetailPanel'
import { PaymentModal } from '../components/payment/PaymentModal'
import { TransactionHistory } from '../components/payment/TransactionHistory'
import { Toast } from '../components/ui/Toast'
import { Button } from '../components/ui/Button'
import { get, post } from '../services/api'
import { useNotificationStore } from '../store/notificationStore'
import { useCustomer } from '../hooks/useCustomer'
import { formatCurrency } from '../utils/format'
import { useAuthStore } from '../store/authStore'
import { loadPaymentDraft } from '../utils/paymentDraft'

const TERMINAL_STATUSES = ['completed', 'settled', 'voided']

export default function Payment() {
  const { data, isLoading } = usePaymentQueue()
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)
  const username = useAuthStore((state) => state.user?.username)

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const { data: selectedCustomer } = useCustomer(selectedTransaction?.customer_id)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const [queueFilter, setQueueFilter] = useState('regular')
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'history' ? 'history' : 'queue'

  const toggleView = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (view === 'history') {
        next.delete('view')
      } else {
        next.set('view', 'history')
      }
      return next
    })
  }

  const isAdjustmentChild = (t) => ['adjustment', 'refund'].includes(t.transaction_type) && t.parent_transaction_id != null

  const queueItems = data?.items ?? []
  const filteredQueueItems =
    queueFilter === 'adjustments'
      ? queueItems.filter(isAdjustmentChild)
      : queueItems.filter((t) => !isAdjustmentChild(t))

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  // Covers the narrow race window before FIX 4's disconnect-triggered release
  // finishes: if this same user still holds a transaction from just before
  // the reload, restore it instead of losing the in-progress work silently.
  // If a localStorage draft for that same transaction says the Payment modal
  // was open, reopen it too — PaymentModal itself restores the entry rows.
  useEffect(() => {
    get('/transactions?status=pending_payment&processing_by=me')
      .then((result) => {
        const mine = result?.items?.[0]
        if (mine) {
          setSelectedTransaction(mine)
          if (loadPaymentDraft(username, mine.id)?.open) setPayModalOpen(true)
        }
      })
      .catch(() => {})
  }, [username])

  const showToast = (message, variant = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, variant })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  // Edge case: another team member finishes this same transaction (shouldn't
  // normally happen since /grab locks it, but e.g. an admin void) while it's
  // still open here — drop it instead of leaving a stale, now-invalid order
  // in Order Details with the queue stuck dimmed behind it.
  useEffect(() => {
    if (!selectedTransaction || !lastEvent) return
    if (lastEvent.type !== 'transaction_status_changed') return
    if (lastEvent.transaction_id !== selectedTransaction.id) return
    if (!TERMINAL_STATUSES.includes(lastEvent.new_status)) return

    setSelectedTransaction(null)
    setPayModalOpen(false)
    showToast('This transaction has been completed by another team member', 'info')
  }, [lastEvent, selectedTransaction])

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

  const handlePaid = () => {
    setPayModalOpen(false)
    setSelectedTransaction(null)
    refreshQueue()
    showToast('Payment processed successfully', 'success')
  }

  const handleItemsUpdated = (updatedTransaction) => {
    setSelectedTransaction(updatedTransaction)
    refreshQueue()
    showToast('Items updated', 'success')
  }

  const handleItemsReverted = (updatedTransaction) => {
    setSelectedTransaction(updatedTransaction)
    refreshQueue()
    showToast('Items reverted to original', 'success')
  }

  const handleSaveAsCredit = async () => {
    try {
      await post(`/transactions/${selectedTransaction.id}/resolve-as-credit`)
      showToast(
        `${formatCurrency(selectedTransaction.total_due)} saved as credit for ${selectedCustomer?.full_name}`,
        'success',
      )
      setSelectedTransaction(null)
      refreshQueue()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  return (
    <PageLayout
      title="Payment Queue"
      actions={
        <Button
          variant="secondary"
          className="!border-brand-gold !text-brand-gold hover:!bg-brand-gold hover:!text-brand-black"
          onClick={toggleView}
        >
          {view === 'history' ? 'Back to Queue' : 'History'}
        </Button>
      }
    >
      {view === 'history' ? (
        <TransactionHistory />
      ) : (
        <div className="h-full flex gap-6 min-h-0">
          <div className="flex-[60] h-full min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Queue</span>
              <div className="inline-flex rounded-full bg-gray-200 p-0.5">
                {[
                  { value: 'regular', label: 'Regular' },
                  { value: 'adjustments', label: 'Adjustments' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setQueueFilter(option.value)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      queueFilter === option.value
                        ? 'bg-brand-black text-brand-gold'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-4 ${
                selectedTransaction ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              {selectedTransaction && (
                <div className="mb-3 px-3 py-2 rounded-md bg-yellow-100 text-sm text-amber-800">
                  Finish or park the current transaction before processing another.
                </div>
              )}
              <QueuePanel transactions={filteredQueueItems} isLoading={isLoading} onProcess={handleProcess} />
            </div>
          </div>

          <div className="flex-[40] h-full min-h-0 flex flex-col">
            <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Order Details</span>
            <div className="flex-1 min-h-0 bg-gray-100 border border-brand-black/20 rounded-lg p-3">
              <TransactionDetailPanel
                transaction={selectedTransaction}
                onPay={() => setPayModalOpen(true)}
                onPark={handlePark}
                onSaveAsCredit={handleSaveAsCredit}
                onItemsUpdated={handleItemsUpdated}
                onItemsReverted={handleItemsReverted}
              />
            </div>
          </div>
        </div>
      )}

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
