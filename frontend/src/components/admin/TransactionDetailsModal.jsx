import { useEffect, useMemo, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { get } from '../../services/api'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'
import { Badge } from '../ui/Badge'
import { useArticleRows } from '../../hooks/useArticleRows'
import { getTransactionTypeLabel } from '../../utils/transactionType'
import { formatCurrency } from '../../utils/format'
import { getDisplayStatus } from '../../utils/transactionStatus'

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

// Compact static line for the Details column when the chain is exactly one
// original + one adjustment child (see isUnifiedLinkedCase) — no
// payment-method breakdown, no expand affordance, per design decision.
function AdjustmentStatusBadge({ transaction }) {
  const { status, label } = getDisplayStatus(transaction)
  return (
    <Badge status={status} className={status === 'voided' ? 'line-through' : ''}>
      {`ADJUSTMENT ${formatCurrency(transaction.total_due)} · ${label ?? 'Pending'}`}
    </Badge>
  )
}

// Refund/credit children are always resolved via /resolve-as-credit — there's
// no reachable path leaving one unresolved-and-visible here, so this badge is
// fixed-content (no payment_status derivation, unlike the adjustment badge
// above — a refund child has no payment_detail-based status to derive from).
// Standalone span (not the Badge component) so its color can't collide with
// Badge's status-keyed style map — teal keeps it visually distinct from the
// adjustment badge's green/amber/gray/red palette.
function CreditBadge({ transaction }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
      {`CREDIT ${formatCurrency(transaction.total_due)}`}
    </span>
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

  // Scope guard for the unified single-card layout: exactly one parent
  // (original) + exactly one child, and that child must be an adjustment
  // ("customer owes more") or a refund ("store owes customer", always
  // resolved to credit — see CreditBadge above) — both are pure total_due
  // rows with no items of their own. Any other chain shape (no children,
  // multiple children, etc.) falls through to the existing stacked
  // rendering below, untouched.
  const childTransactions = originalTxn ? chain.filter((t) => t.parent_transaction_id === originalTxn.id) : []
  const isUnifiedLinkedCase =
    Boolean(originalTxn) &&
    chain.length === 2 &&
    childTransactions.length === 1 &&
    (childTransactions[0].transaction_type === 'adjustment' || childTransactions[0].transaction_type === 'refund')

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

  // Reuses the exact same before→after pairing the Adjustment box itself
  // derives (useArticleRows(linkedChildTxn) reads linkedChildTxn.parent.items,
  // i.e. these are the same underlying items as originalAsParent above) — no
  // separate matching mechanism, just borrowing its `adjusted` result to know
  // which product_ids to flag in the Original box.
  const { adjusted: linkedAdjustedRows } = useArticleRows(linkedChildTxn)
  const highlightedProductIds = useMemo(
    () => new Set(linkedAdjustedRows.map((row) => row.product_id)),
    [linkedAdjustedRows]
  )
  const highlightColor = linkedChildTxn?.transaction_type === 'refund' ? 'blue' : 'amber'

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
              {isUnifiedLinkedCase ? (
                <div className="flex-1 min-h-0 flex flex-col gap-2">
                  <span className="text-sm font-medium">Original - {originalTxn.order_number}</span>
                  <ArticleTable>
                    <ArticleRows
                      transaction={originalAsParent}
                      variant="plain"
                      align="center"
                      highlightedProductIds={highlightedProductIds}
                      highlightColor={highlightColor}
                    />
                  </ArticleTable>
                </div>
              ) : hasLinkedAdjustment ? (
                <>
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <span className="text-sm font-medium">Original - {originalTxn.order_number}</span>
                    <ArticleTable>
                      <ArticleRows
                        transaction={originalAsParent}
                        variant="plain"
                        align="center"
                        highlightedProductIds={highlightedProductIds}
                        highlightColor={highlightColor}
                      />
                    </ArticleTable>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <span className="text-sm font-medium">
                      {getTransactionTypeLabel(linkedChildTxn.transaction_type)} - {linkedChildTxn.order_number}
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
              <div className="flex-1 min-h-0 bg-gray-100 border border-gray-400 rounded-lg flex flex-col justify-end p-3">
                {isUnifiedLinkedCase &&
                  (childTransactions[0].transaction_type === 'refund' ? (
                    <CreditBadge transaction={childTransactions[0]} />
                  ) : (
                    <AdjustmentStatusBadge transaction={childTransactions[0]} />
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}
