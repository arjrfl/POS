import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Badge } from '../ui/Badge'
import { formatCurrency } from '../../utils/currency'

export function TransactionChainDetails({ transactionId }) {
  const { data: chain, isLoading } = useQuery({
    queryKey: ['transaction-chain', transactionId],
    queryFn: () => get(`/transactions/${transactionId}/chain`),
  })

  if (isLoading) return <p className="text-sm text-gray-500 px-3 py-2">Loading chain...</p>
  if (!chain?.length) return <p className="text-sm text-gray-500 px-3 py-2">No chain data.</p>

  return (
    <div className="px-3 py-3 bg-gray-50">
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <th className="px-2 py-1">Order #</th>
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1 text-right">Total Due</th>
            <th className="px-2 py-1">Parent</th>
          </tr>
        </thead>
        <tbody>
          {chain.map((t) => (
            <tr key={t.id} className="border-t border-gray-200">
              <td className="px-2 py-1.5 text-sm font-medium text-gray-900">{t.order_number}</td>
              <td className="px-2 py-1.5 text-sm text-gray-600 capitalize">{t.transaction_type}</td>
              <td className="px-2 py-1.5">
                <Badge status={t.transaction_status} />
              </td>
              <td className="px-2 py-1.5 text-sm text-right text-gray-900">{formatCurrency(t.total_due)}</td>
              <td className="px-2 py-1.5 text-sm text-gray-500">{t.parent_transaction_id ? `#${t.parent_transaction_id}` : 'original'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
