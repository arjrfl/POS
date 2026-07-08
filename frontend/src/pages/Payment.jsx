import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { usePaymentQueue } from '../hooks/useQueue'
import { QueuePanel } from '../components/payment/QueuePanel'
import { PaymentProcessor } from '../components/payment/PaymentProcessor'
import { ReceiptModal } from '../components/payment/ReceiptModal'
import { Card } from '../components/ui/Card'
import { post } from '../services/api'

const initialPaymentState = { payments: [], isValid: false, changeGiven: 0 }

export default function Payment() {
  const { data, isLoading } = usePaymentQueue()
  const queryClient = useQueryClient()

  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [paymentState, setPaymentState] = useState(initialPaymentState)
  const [receiptTransaction, setReceiptTransaction] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  const handleProcess = async (transaction) => {
    try {
      // A parked transaction isn't 'waiting', so /grab would reject it — /unpark
      // is the equivalent reclaim action for anything already parked.
      const endpoint = transaction.queue_status === 'parked' ? 'unpark' : 'grab'
      const grabbed = await post(`/transactions/${transaction.id}/${endpoint}`)
      setSelectedTransaction(grabbed)
      setPaymentState(initialPaymentState)
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    }
  }

  const handleConfirmPayment = async () => {
    if (!paymentState.isValid) return
    setSubmitting(true)
    try {
      const paid = await post(`/transactions/${selectedTransaction.id}/pay`, { payments: paymentState.payments })
      setReceiptTransaction(paid)
      setSelectedTransaction(null)
      setPaymentState(initialPaymentState)
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePark = async () => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/park`)
      setSelectedTransaction(null)
      setPaymentState(initialPaymentState)
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRelease = async () => {
    setSubmitting(true)
    try {
      await post(`/transactions/${selectedTransaction.id}/release`)
      setSelectedTransaction(null)
      setPaymentState(initialPaymentState)
      refreshQueue()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCloseReceipt = () => {
    setReceiptTransaction(null)
  }

  return (
    <PageLayout title="Payment Queue">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <QueuePanel transactions={data?.items ?? []} isLoading={isLoading} onProcess={handleProcess} />
        </Card>

        {selectedTransaction && (
          <PaymentProcessor
            transaction={selectedTransaction}
            paymentState={paymentState}
            onPaymentFormChange={setPaymentState}
            onConfirmPayment={handleConfirmPayment}
            onPark={handlePark}
            onRelease={handleRelease}
            submitting={submitting}
          />
        )}
      </div>

      <ReceiptModal transaction={receiptTransaction} onClose={handleCloseReceipt} />
    </PageLayout>
  )
}
