import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { CreateTransactionModal } from '../components/walkin/CreateTransactionModal'
import { ProductStockPanel } from '../components/walkin/ProductStockPanel'
import { Button } from '../components/ui/Button'
import { Toast } from '../components/ui/Toast'
import { useAuthStore } from '../store/authStore'
import { loadReceiverDraft } from '../utils/receiverDraft'
import { useReceiverLiveSync } from '../hooks/useReceiverLiveSync'

export default function WalkIn() {
  const queryClient = useQueryClient()
  const username = useAuthStore((state) => state.user?.username)

  const [createOpen, setCreateOpen] = useState(() => !!loadReceiverDraft(username)?.open)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  useReceiverLiveSync()

  const showToast = (message, variant = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, variant })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
  }

  return (
    <PageLayout title="Receiver">
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Receiver</h1>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
            + Create Transaction
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <ProductStockPanel />
        </div>
      </div>

      <CreateTransactionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        showToast={showToast}
      />

      <Toast toast={toast} />
    </PageLayout>
  )
}
