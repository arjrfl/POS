import { PageLayout } from '../components/layout/PageLayout'
import { OperationsStockTable } from '../components/operations/OperationsStockTable'
import { useOperationsLiveSync } from '../hooks/useOperationsLiveSync'

export default function Operations() {
  useOperationsLiveSync()

  return (
    <PageLayout title="Operations">
      <div className="h-full flex flex-col min-h-0">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Stock Monitor</span>
        <div className="flex-1 min-h-0 bg-gray-100 border border-brand-black/20 rounded-lg p-4">
          <OperationsStockTable />
        </div>
      </div>
    </PageLayout>
  )
}
