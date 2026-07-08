import { useState } from 'react'
import { useCustomers } from '../../hooks/useCustomer'
import { CustomerDetailPanel } from './CustomerDetailPanel'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { formatCurrency } from '../../utils/format'

function NetBalanceCell({ netBalance }) {
  const amount = Number(netBalance)
  if (amount > 0) return <span className="text-green-700 font-medium">+{formatCurrency(amount)}</span>
  if (amount < 0) return <span className="text-red-600 font-medium">-{formatCurrency(Math.abs(amount))}</span>
  return <span className="text-gray-500">₱0.00</span>
}

export function CustomersSection() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { data: customers, isLoading } = useCustomers(search)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="flex flex-col gap-3">
        <Input
          id="customer-list-search"
          label="Search customers"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2 text-right">Net Balance</th>
                  <th className="px-3 py-2">Status</th>
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
                    <td className="px-3 py-2 text-sm font-medium text-gray-900">{customer.full_name}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{customer.contact_number ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-right">
                      <NetBalanceCell netBalance={customer.net_balance} />
                    </td>
                    <td className="px-3 py-2">
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
