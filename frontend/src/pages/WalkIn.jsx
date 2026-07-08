import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { QueuePanel } from '../components/walkin/QueuePanel'
import { CreateTransactionModal } from '../components/walkin/CreateTransactionModal'
import { EditOrderModal } from '../components/walkin/EditOrderModal'
import { Toast } from '../components/ui/Toast'
import { Button } from '../components/ui/Button'
import { useReceiverQueue } from '../hooks/useQueue'
import { useAuth } from '../hooks/useAuth'
import { post } from '../services/api'

export default function WalkIn() {
  const { user } = useAuth()
  const { data, isLoading } = useReceiverQueue()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: ['transactions'] })

  const showToast = (message, variant = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, variant })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  const handleEditOrder = async (transaction) => {
    try {
      const grabbed = await post(`/transactions/${transaction.id}/grab`)
      setEditingTransaction(grabbed)
      refreshQueue()
    } catch (err) {
      showToast(
        err.status === 409 ? 'This transaction is being edited by another team member' : err.message,
        'error',
      )
    }
  }

  const handleCreated = () => {
    refreshQueue()
  }

  const handleEditClosed = () => {
    setEditingTransaction(null)
    refreshQueue()
  }

  return (
    <PageLayout title="Receiver Queue">
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Receiver Queue</h1>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            + Create Transaction
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <QueuePanel
            transactions={data?.items ?? []}
            isLoading={isLoading}
            currentUserId={user?.id}
            onEditOrder={handleEditOrder}
          />
        </div>
      </div>

      <CreateTransactionModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />

      {editingTransaction && (
        <EditOrderModal
          transaction={editingTransaction}
          onClose={handleEditClosed}
          onSent={() => showToast('Transaction sent to Payment queue', 'success')}
        />
      )}

      <Toast toast={toast} />
    </PageLayout>
  )
}
