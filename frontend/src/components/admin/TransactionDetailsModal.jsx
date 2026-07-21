import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { FullScreenModal } from '../ui/FullScreenModal'
import { get } from '../../services/api'

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const ARTICLE_TABLE_COLUMNS = ['QTY', 'UNIT', 'ARTICLES', 'UNIT PRICE', 'AMOUNT']

function ArticleTable() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg">
      <div className="grid grid-cols-5 sticky top-0 bg-gray-100 border-b border-gray-400 px-3 py-2">
        {ARTICLE_TABLE_COLUMNS.map((column) => (
          <span key={column} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {column}
          </span>
        ))}
      </div>
    </div>
  )
}

export function TransactionDetailsModal({ transactionId, onClose }) {
  const [chain, setChain] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setChain(null)
    setError(null)
    setLoading(true)

    get(`/transactions/${transactionId}/chain`)
      .then((data) => {
        if (!cancelled) setChain(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load transaction')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [transactionId])

  const originalTxn = chain?.find((t) => t.transaction_type === 'original')
  const linkedChildTxn = originalTxn
    ? chain?.find(
        (t) =>
          t.parent_transaction_id === originalTxn.id &&
          (t.transaction_type === 'adjustment' || t.transaction_type === 'refund')
      )
    : null
  const hasLinkedAdjustment = Boolean(linkedChildTxn)

  return (
    <FullScreenModal open={true} onClose={onClose} title="Transaction History">
      <div className="flex flex-col gap-4 h-full min-h-0">
        <div className="shrink-0">
          <Button type="button" variant="secondary" onClick={onClose}>
            ‹ Back
          </Button>
        </div>

        {loading && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="flex-1 min-h-0 flex gap-[10px] p-[10px]">
            <div className={`${hasLinkedAdjustment ? 'w-[380px]' : 'w-[520px]'} shrink-0 flex flex-col gap-2 min-h-0`}>
              <span className="text-sm font-medium">
                {hasLinkedAdjustment ? `Original - ${originalTxn.order_number}` : 'Original'}
              </span>
              <ArticleTable />
            </div>

            {hasLinkedAdjustment && (
              <div className="w-[380px] shrink-0 flex flex-col gap-2 min-h-0">
                <span className="text-sm font-medium">
                  {capitalize(linkedChildTxn.transaction_type)} - {linkedChildTxn.order_number}
                </span>
                <ArticleTable />
              </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
              <span className="text-sm font-medium">Details</span>
              <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg" />
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}
