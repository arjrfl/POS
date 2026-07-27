import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'
import { Button } from '../ui/Button'

const fetchTransactionHistory = () => get('/transactions/history')

function formatHistoryDateTime(iso) {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${datePart}, ${timePart}`
}

function HistoryRow({ transaction }) {
  const typeBadge = CUSTOMER_TYPE_BADGE[transaction.customer_type]

  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50">
      <td className="px-4 py-2 text-sm text-left font-mono text-gray-900">{transaction.order_number}</td>
      <td className="px-4 py-2 text-sm text-left text-gray-800">{transaction.customer_name}</td>
      <td className="px-4 py-2 text-sm text-left text-gray-800">{transaction.cashier_name ?? '—'}</td>
      <td className="px-4 py-2 text-center">
        {typeBadge && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-center text-sm text-gray-600 whitespace-nowrap">
        {formatHistoryDateTime(transaction.finished_at)}
      </td>
      <td className="px-4 py-2 text-sm text-right tabular-nums text-gray-800">
        {formatCurrency(transaction.total_due)}
      </td>
      <td className="px-4 py-2 text-center whitespace-nowrap">
        <Button type="button" variant="outline" className="!px-3 !py-1 text-xs inline-flex items-center gap-1">
          <Printer size={14} />
          Print
        </Button>
      </td>
    </tr>
  )
}

export function TransactionHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'history'],
    queryFn: fetchTransactionHistory,
  })

  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const runSearch = () => setSearchTerm(searchInput.trim().toLowerCase())

  const filteredData = useMemo(() => {
    if (!data) return data
    if (!searchTerm) return data
    return data.filter((transaction) => {
      const orderNumber = transaction.order_number?.toLowerCase() ?? ''
      const customerName = transaction.customer_name?.toLowerCase() ?? ''
      return orderNumber.includes(searchTerm) || customerName.includes(searchTerm)
    })
  }, [data, searchTerm])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Transaction History</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="Search order number or customer..."
            className="w-72 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
          <button
            type="button"
            onClick={runSearch}
            className="px-4 py-1.5 text-sm font-medium bg-brand-black text-brand-gold border border-brand-gold rounded-md hover:bg-brand-gold hover:text-brand-black"
          >
            Search
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg">
        <table className="table-auto w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Transaction ID
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Customer
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Cashier
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                Type
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                Date &amp; Time
              </th>
              <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                Total
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                  Loading history...
                </td>
              </tr>
            ) : !data || data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                  No completed transactions yet
                </td>
              </tr>
            ) : filteredData.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                  No matching transactions
                </td>
              </tr>
            ) : (
              filteredData.map((transaction) => <HistoryRow key={transaction.id} transaction={transaction} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
