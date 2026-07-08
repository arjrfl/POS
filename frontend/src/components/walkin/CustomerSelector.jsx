import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { AddCustomerModal } from './AddCustomerModal'
import { formatCurrency } from '../../utils/currency'

function BalanceLine({ netBalance }) {
  const amount = Number(netBalance)
  if (amount > 0) return <span className="text-sm text-green-700">Credit: {formatCurrency(amount)}</span>
  if (amount < 0) return <span className="text-sm text-red-600">Balance: {formatCurrency(Math.abs(amount))}</span>
  return null
}

export function CustomerSelector({
  value,
  onSelect,
  onClear,
  onAddBalanceSettlement,
  onAddCreditUsage,
  hasBalanceItem,
  hasCreditItem,
}) {
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

  // Needed for reference_transaction_id on balance_settlement/credit_usage items —
  // the most recent ledger entry is used as the "originating transaction" since
  // net_balance is a single running total with no one true source transaction.
  const netBalance = value ? Number(value.net_balance) : 0
  const { data: customerDetail } = useQuery({
    queryKey: ['customer-detail', value?.id],
    queryFn: () => get(`/customers/${value.id}`),
    enabled: !!value && netBalance !== 0,
  })

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

  const latestLedgerTransactionId = customerDetail?.ledger_entries?.at(-1)?.transaction_id ?? null

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

      {value && netBalance !== 0 && (
        <div className="mt-2 flex flex-col items-start gap-1">
          <BalanceLine netBalance={netBalance} />

          {netBalance < 0 && !hasBalanceItem && (
            <Button
              type="button"
              variant="danger"
              disabled={!latestLedgerTransactionId}
              onClick={() => onAddBalanceSettlement(Math.abs(netBalance), latestLedgerTransactionId)}
            >
              + Add Balance to Settle
            </Button>
          )}

          {netBalance > 0 && !hasCreditItem && (
            <Button
              type="button"
              disabled={!latestLedgerTransactionId}
              onClick={() => onAddCreditUsage(netBalance, latestLedgerTransactionId)}
            >
              - Apply Credit
            </Button>
          )}
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
