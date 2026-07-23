import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Input } from '../ui/Input'
import { AddCustomerModal } from './AddCustomerModal'
import { formatCurrency } from '../../utils/format'

// Credit side stays net_balance-derived (untouched, per the balance-only fix
// below). Balance side now reads customer.total_balance — the gross sum of
// outstanding balance_added ledger entries (same aggregation as Admin's TOTAL
// BALANCE and Payment's balance checkboxes — see customer_service
// .get_outstanding_balance_total) — instead of netBalance's sign/magnitude,
// which understates what's owed whenever this customer also carries credit
// (net_balance nets the two together into one column).
function BalanceLine({ netBalance, totalBalance }) {
  const creditAmount = Number(netBalance)
  const balanceAmount = Number(totalBalance)
  return (
    <>
      {balanceAmount > 0 && (
        <span className="text-sm text-red-600 block">Has balance: {formatCurrency(balanceAmount)}</span>
      )}
      {creditAmount > 0 && <span className="text-sm text-green-700 block">Has credit: {formatCurrency(creditAmount)}</span>}
    </>
  )
}

export function CustomerSelector({ value, onSelect, onClear }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedTerm(searchTerm), 300)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const { data: customers } = useQuery({
    queryKey: ['customers', debouncedTerm],
    queryFn: () => get(`/customers${debouncedTerm ? `?search=${encodeURIComponent(debouncedTerm)}` : ''}`),
    enabled: isOpen && !value,
  })

  const netBalance = value ? Number(value.net_balance) : 0
  const totalBalance = value ? Number(value.total_balance) : 0

  const handleSelect = (customer) => {
    onSelect(customer)
    setSearchTerm('')
    setIsOpen(false)
    setShowAddModal(false)
  }

  const handleCreated = (customer) => {
    queryClient.invalidateQueries({ queryKey: ['customers'] })
    handleSelect(customer)
  }

  const handleClear = () => {
    onClear()
    setSearchTerm('')
  }

  const trimmedTerm = debouncedTerm.trim()
  const noResults = !!customers && customers.length === 0 && trimmedTerm.length >= 2

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-gray-700">Customer</span>
        {value && (
          <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            {value.full_name}
            <button
              type="button"
              onClick={handleClear}
              className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-primary/20"
              aria-label="Clear selected customer"
            >
              &#10005;
            </button>
          </span>
        )}
      </div>

      <Input
        id="customer-search"
        placeholder="Search customer..."
        value={value ? '' : searchTerm}
        disabled={!!value}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        autoComplete="off"
      />

      {isOpen && !value && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {customers?.length ? (
            customers.map((customer) => (
              <button
                type="button"
                key={customer.id}
                onMouseDown={() => handleSelect(customer)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium text-gray-900">{customer.full_name}</div>
                {customer.contact_number && <div className="text-sm text-gray-500">{customer.contact_number}</div>}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500">
              {trimmedTerm.length > 0 ? 'No customers found.' : 'Start typing to search.'}
            </div>
          )}

          {noResults && (
            <button
              type="button"
              onMouseDown={() => setShowAddModal(true)}
              className="w-full text-left px-3 py-2 border-t border-gray-200 bg-primary text-white font-medium hover:bg-primary-dark"
            >
              No customer found — + Add Customer
            </button>
          )}
        </div>
      )}

      {value && (totalBalance > 0 || netBalance > 0) && (
        <div className="mt-2">
          <BalanceLine netBalance={netBalance} totalBalance={totalBalance} />
        </div>
      )}

      <AddCustomerModal
        open={showAddModal}
        initialName={searchTerm}
        onClose={() => setShowAddModal(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
