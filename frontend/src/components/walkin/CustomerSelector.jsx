import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../services/api'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
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
  onAddBalanceSettlement,
  onAddCreditUsage,
  hasBalanceItem,
  hasCreditItem,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedTerm(searchTerm), 300)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const { data: customers } = useQuery({
    queryKey: ['customers', debouncedTerm],
    queryFn: () => get(`/customers${debouncedTerm ? `?search=${encodeURIComponent(debouncedTerm)}` : ''}`),
    enabled: isOpen,
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
  }

  const latestLedgerTransactionId = customerDetail?.ledger_entries?.at(-1)?.transaction_id ?? null

  return (
    <div className="relative">
      <Input
        id="customer-search"
        label="Customer"
        placeholder="Search customer by name..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        autoComplete="off"
      />

      {isOpen && (
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
                <BalanceLine netBalance={customer.net_balance} />
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500">No customers found.</div>
          )}
        </div>
      )}

      {value && (
        <div className="mt-3 p-3 bg-gray-50 rounded-md">
          <div className="font-medium text-gray-900">{value.full_name}</div>
          <BalanceLine netBalance={value.net_balance} />

          {netBalance < 0 && !hasBalanceItem && (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              disabled={!latestLedgerTransactionId}
              onClick={() => onAddBalanceSettlement(Math.abs(netBalance), latestLedgerTransactionId)}
            >
              + Add balance to settle
            </Button>
          )}

          {netBalance > 0 && !hasCreditItem && (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              disabled={!latestLedgerTransactionId}
              onClick={() => onAddCreditUsage(netBalance, latestLedgerTransactionId)}
            >
              - Apply credit
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
