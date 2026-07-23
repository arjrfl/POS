import { useState } from 'react'
import { useCustomers } from '../../hooks/useCustomer'
import { CustomerDetailPanel } from './CustomerDetailPanel'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

// Same net_balance sign split CLAUDE.md documents (positive = credit,
// negative = balance/utang) — split into two dedicated cells (debt-only,
// credit-only) instead of one combined signed cell, so the list can show
// them as separate columns.
function NetBalanceDebtCell({ netBalance }) {
  const amount = Number(netBalance)
  if (amount >= 0) return <span className="text-gray-500">₱0.00</span>
  return <span className="text-red-600 font-medium">{formatCurrency(Math.abs(amount))}</span>
}

function NetBalanceCreditCell({ netBalance }) {
  const amount = Number(netBalance)
  if (amount <= 0) return <span className="text-gray-500">₱0.00</span>
  return <span className="text-green-700 font-medium">{formatCurrency(amount)}</span>
}

export function CustomersSection() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { data: customers, isLoading } = useCustomers(search)

  const runSearch = () => setSearch(searchInput)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-0">
      <Card className="flex flex-col gap-3 min-h-0">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              id="customer-list-search"
              label="Search customers"
              placeholder="Search by name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
            />
          </div>
          <Button type="button" variant="primary" onClick={runSearch}>
            Search
          </Button>
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="w-1/4 px-3 py-2">Name</th>
                  <th className="w-1/4 px-3 py-2 text-right">Net Balance</th>
                  <th className="w-1/4 px-3 py-2 text-right">Net Credit</th>
                  <th className="w-1/4 px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {customers?.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                    className={`border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                      selectedId === customer.id ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-sm font-medium text-gray-900 truncate">{customer.full_name}</td>
                    <td className="px-3 py-2 text-sm text-right">
                      <NetBalanceDebtCell netBalance={customer.net_balance} />
                    </td>
                    <td className="px-3 py-2 text-sm text-right">
                      <NetBalanceCreditCell netBalance={customer.net_balance} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge status={customer.customer_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {customers?.length === 0 && <p className="text-gray-500 text-sm py-4">No customers found.</p>}
          </div>
        )}
      </Card>

      {selectedId ? (
        <CustomerDetailPanel customerId={selectedId} />
      ) : (
        <Card className="flex items-center justify-center text-gray-400 text-sm py-16">
          Select a customer to view their details.
        </Card>
      )}
    </div>
  )
}
