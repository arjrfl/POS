import { useEffect, useMemo, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { get } from '../../services/api'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const ARTICLE_TABLE_COLUMNS = ['QTY', 'UNIT', 'ARTICLES', 'UNIT PRICE', 'AMOUNT']

// ArticleRows renders <tr> rows meant for a real <table><tbody> (see its own
// comment) — a header-only div/grid can't host them, so the header lives in a
// <thead> here instead, keeping the same sticky/label styling as before.
// table-fixed + ARTICLE_ROW_COLUMN_WIDTHS on the header cells (matching the
// widths ArticleRows itself sets on its <td>s) keeps the header and every row
// pixel-aligned on the same 5 proportional columns.
function ArticleTable({ children }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg">
      <table className="w-full table-fixed text-sm">
        <thead className="sticky top-0 bg-gray-100 border-b border-gray-400">
          <tr>
            {ARTICLE_TABLE_COLUMNS.map((column, index) => (
              <th
                key={column}
                className={`px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 ${ARTICLE_ROW_COLUMN_WIDTHS[index]}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
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

  // ArticleRows/useArticleRows always read transaction.parent.items (built for
  // an adjustment/refund child, which carries no items of its own — see
  // resolve_substandard) — an original has no parent, so this wraps it the
  // same shape to reuse that exact pipeline unchanged for the Original box.
  // Filtered to product-type items only, matching _build_parent_summary's own
  // filter for the real parent-items path.
  const originalAsParent = useMemo(() => {
    if (!originalTxn) return null
    return { parent: { ...originalTxn, items: originalTxn.items.filter((item) => item.item_type === 'product') } }
  }, [originalTxn])

  return (
    <FullScreenModal open={true} onClose={onClose} title="Transaction History" closeLabel="‹ Back">
      <div className="flex flex-col h-full min-h-0">
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
            <div className="flex-1 min-w-0 flex flex-col gap-[10px] min-h-0">
              {hasLinkedAdjustment ? (
                <>
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <span className="text-sm font-medium">Original - {originalTxn.order_number}</span>
                    <ArticleTable>
                      <ArticleRows transaction={originalAsParent} variant="plain" align="center" />
                    </ArticleTable>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <span className="text-sm font-medium">
                      {capitalize(linkedChildTxn.transaction_type)} - {linkedChildTxn.order_number}
                    </span>
                    <ArticleTable>
                      <ArticleRows transaction={linkedChildTxn} variant="adjusted" align="center" />
                    </ArticleTable>
                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col gap-2">
                  <span className="text-sm font-medium">Original</span>
                  <ArticleTable>
                    <ArticleRows transaction={originalAsParent} variant="plain" align="center" />
                  </ArticleTable>
                </div>
              )}
            </div>

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
