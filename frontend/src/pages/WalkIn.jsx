import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageLayout } from '../components/layout/PageLayout'
import { CreateTransactionModal } from '../components/walkin/CreateTransactionModal'
import { Button } from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { loadReceiverDraft } from '../utils/receiverDraft'

export default function WalkIn() {
  const queryClient = useQueryClient()
  const username = useAuthStore((state) => state.user?.username)

  const [createOpen, setCreateOpen] = useState(() => !!loadReceiverDraft(username)?.open)

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
  }

  return (
    <PageLayout title="Receiver">
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Receiver</h1>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            + Create Transaction
          </Button>
        </div>
      </div>

      <CreateTransactionModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </PageLayout>
  )
}
