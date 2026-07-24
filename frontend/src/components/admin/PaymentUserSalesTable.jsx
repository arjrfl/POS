import { useQuery } from '@tanstack/react-query'
import { Card } from '../ui/Card'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { buildRangeQueryString } from '../../utils/dateRange'

const MASKED_VALUE = '••••••'

export function PaymentUserSalesTable({ fromDate, toDate, rangeLabel, valuesHidden = false }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'payment-user-sales', fromDate, toDate],
    queryFn: () => get(`/admin/dashboard/payment-user-sales${buildRangeQueryString(fromDate, toDate)}`),
  })

  return (
    <Card className="flex flex-col h-full">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        {rangeLabel ? `Payment Users — Sales ${rangeLabel}` : 'Payment Users — Sales Today'}
      </h2>

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

      {!isLoading && data?.length === 0 && (
        <div className="flex items-center justify-center flex-1">
          <p className="text-gray-400 text-sm">No active payment users</p>
        </div>
      )}

      {!isLoading && data?.length > 0 && (
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2 text-xs font-medium uppercase tracking-wide">Payment User</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wide text-center">Processed</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wide text-right">Total Sales</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wide text-right">Actual Sales</th>
                <th className="py-2 pl-2 text-xs font-medium uppercase tracking-wide text-right">Unpaid</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.user_id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-2">
                    <div className="text-gray-900">{row.full_name}</div>
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900">
                    {valuesHidden ? MASKED_VALUE : row.transactions_processed}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-900">
                    {valuesHidden ? MASKED_VALUE : formatCurrency(row.total_sales)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-900">
                    {valuesHidden ? MASKED_VALUE : formatCurrency(row.actual_total_sales)}
                  </td>
                  <td className="py-2 pl-2 text-right text-gray-900">
                    {valuesHidden ? MASKED_VALUE : formatCurrency(row.unpaid_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
