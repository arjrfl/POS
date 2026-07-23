import { useEffect, useMemo, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Badge } from '../ui/Badge'
import { get } from '../../services/api'
import { useCustomer } from '../../hooks/useCustomer'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'
import { useArticleRows } from '../../hooks/useArticleRows'
import { getTransactionTypeLabel } from '../../utils/transactionType'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'
import { PAYMENT_METHOD_LABEL } from '../../utils/paymentMethod'
import { formatCurrency } from '../../utils/format'

const ARTICLE_TABLE_COLUMNS = ['QTY', 'UNIT', 'ARTICLES', 'UNIT PRICE', 'AMOUNT']
const PAYMENT_ENTRY_LABELS = { ...PAYMENT_METHOD_LABEL, credit: 'Credit' }

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : null
}

// Label/value row for the Details column — omits itself when value is nullish,
// which is what most of the spec's "only if" / "omit when null" fields need.
function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between gap-3 text-sm py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  )
}

function SectionHeading({ children }) {
  return <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{children}</h4>
}

// Same subtle line already used above "Total Due" (border-t border-gray-300)
// and by Section B's own top border — reused here rather than a new style, so
// every section boundary in the Details column reads consistently.
function Divider() {
  return <div className="border-t border-gray-300" />
}

function VoidInfoBlock({ voidInfo }) {
  if (!voidInfo) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-3 flex flex-col">
      <InfoRow label="Void Reason" value={voidInfo.void_reason} />
      <InfoRow label="Voided By" value={voidInfo.voided_by_user_name} />
      <InfoRow label="Voided At" value={formatDateTime(voidInfo.voided_at)} />
    </div>
  )
}

function PaymentEntriesBlock({ entries, changeGiven, changeClaimed }) {
  if (!entries?.length) return null
  const totalPaymentEntries = entries.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0)

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 capitalize">
              {PAYMENT_ENTRY_LABELS[entry.payment_method_name] ?? entry.payment_method_name}
            </span>
            {entry.ref_number && <span className="text-gray-500 text-xs truncate">{entry.ref_number}</span>}
          </span>
          <span className="text-gray-900 shrink-0">
            {entry.tendered_amount != null
              ? `${formatCurrency(entry.tendered_amount)} tendered → ${formatCurrency(entry.amount)} applied`
              : formatCurrency(entry.amount)}
          </span>
        </div>
      ))}
      <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
        <span>Total Payment Entries</span>
        <span>{formatCurrency(totalPaymentEntries)}</span>
      </div>
      {Number(changeGiven) > 0 && (
        <div className="flex flex-col">
          <InfoRow label="Change" value={formatCurrency(changeGiven)} />
          <InfoRow label="Change Taken by Customer?" value={changeClaimed ? 'Yes' : 'No'} />
          {!changeClaimed && (
            <InfoRow label="Added to Customer Credit Record" value={formatCurrency(changeGiven)} />
          )}
        </div>
      )}
    </div>
  )
}

function OriginalAmountSummary({ t }) {
  return (
    <div className="flex flex-col">
      <InfoRow label="Estimated Amount" value={formatCurrency(t.estimated_amount)} />
      {t.actual_amount != null && <InfoRow label="Actual Amount" value={formatCurrency(t.actual_amount)} />}
      {Number(t.credit_applied) > 0 && (
        <InfoRow label="Credit Applied" value={`-${formatCurrency(t.credit_applied)}`} />
      )}
      {Number(t.balance_settled) > 0 && (
        <InfoRow label="Balance Settled" value={`+${formatCurrency(t.balance_settled)}`} />
      )}
      {t.remaining_balance_added != null && (
        <InfoRow label="Remaining Balance Added" value={formatCurrency(t.remaining_balance_added)} />
      )}
      <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
        <span>Total Due</span>
        <span>{formatCurrency(t.total_due)}</span>
      </div>
    </div>
  )
}

// Merged role/name/timestamp row — a phase only ever shows up here once it's
// actually happened (timestamp not null), so an in-progress or voided-early
// transaction simply has fewer rows rather than blank ones.
function RoleRow({ role, name, timestamp }) {
  if (!timestamp) return null
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-0.5">
      <span className="text-gray-500 shrink-0">{role}</span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="text-gray-900 truncate">{name ?? '—'}</span>
        <span className="text-gray-500 text-xs shrink-0">{formatDateTime(timestamp)}</span>
      </span>
    </div>
  )
}

// TODO: re-enable when working on Linked Adjustment Transaction details
const SHOW_LINKED_CHILD_SECTION = false

function HandledByBlock({ t }) {
  if (!t.walkin_at && !t.payment_at && !t.releasing_at) return null
  return (
    <div className="flex flex-col">
      <RoleRow role="Receiver" name={t.walkin_user_name} timestamp={t.walkin_at} />
      <RoleRow role="Payment" name={t.payment_user_name} timestamp={t.payment_at} />
      <RoleRow role="Releasing" name={t.releasing_user_name} timestamp={t.releasing_at} />
    </div>
  )
}

// Adjustment/refund children get a `walkin_at` timestamp stamped at creation
// (see _create_adjustment_child) with no matching walkin_user_id — nobody at
// Receiver actually touched this row — so unlike HandledByBlock above (where
// an original's _at/_user_id pairs are always set together), gating here has
// to check the user_id itself per phase, not just the timestamp.
function AdjustmentChildHandledBy({ t }) {
  if (!t.walkin_user_id && !t.payment_user_id && !t.releasing_user_id) return null
  return (
    <div className="flex flex-col">
      <RoleRow role="Receiver" name={t.walkin_user_name} timestamp={t.walkin_user_id ? t.walkin_at : null} />
      <RoleRow role="Payment" name={t.payment_user_name} timestamp={t.payment_user_id ? t.payment_at : null} />
      <RoleRow
        role="Releasing"
        name={t.releasing_user_name}
        timestamp={t.releasing_user_id ? t.releasing_at : null}
      />
    </div>
  )
}

// The Details column (right side) of the modal — Section A (the original
// transaction, always shown) plus Section B (a linked adjustment/refund
// child, only when one exists in the chain). Separate from the left-side
// Article Table, which keeps its own existing rendering untouched.
function DetailsColumn({ originalTxn, linkedChildTxn }) {
  const { data: customer } = useCustomer(originalTxn?.customer_id)
  if (!originalTxn) return null

  const customerTypeBadge = CUSTOMER_TYPE_BADGE[originalTxn.customer_type]
  const isRefundChild = linkedChildTxn?.transaction_type === 'refund'

  // Built as a list (rather than inline JSX) so a divider can be placed before
  // each section without ever landing before one that didn't render (e.g. Void
  // Info on a non-voided transaction) — filter(Boolean) drops those first.
  const sectionsA = [
    originalTxn.void_info && <VoidInfoBlock key="void" voidInfo={originalTxn.void_info} />,
    <div key="handled-by">
      <SectionHeading>Handled By</SectionHeading>
      <HandledByBlock t={originalTxn} />
    </div>,
    <div key="customer">
      <SectionHeading>Customer</SectionHeading>
      <InfoRow label="Name" value={customer?.full_name ?? '...'} />
      <InfoRow label="Address" value={originalTxn.customer_address ?? 'No address on file'} />
    </div>,
    originalTxn.payment_entries?.length > 0 && (
      <div key="payment-entries">
        <SectionHeading>Payment Entries</SectionHeading>
        <PaymentEntriesBlock
          entries={originalTxn.payment_entries}
          changeGiven={originalTxn.change_given}
          changeClaimed={originalTxn.change_claimed}
        />
      </div>
    ),
    <div key="amount-summary">
      <SectionHeading>Amount Summary</SectionHeading>
      <OriginalAmountSummary t={originalTxn} />
    </div>,
  ].filter(Boolean)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{originalTxn.order_number}</span>
          <Badge status={originalTxn.transaction_status} />
          {customerTypeBadge && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${customerTypeBadge.className}`}>
              {customerTypeBadge.label}
            </span>
          )}
          {linkedChildTxn && (
            <span className="text-xs text-gray-500 ml-auto">
              Linked Transaction: {linkedChildTxn.order_number}
            </span>
          )}
        </div>

        {sectionsA.flatMap((section, index) => [<Divider key={`divider-${index}`} />, section])}
      </div>

      {SHOW_LINKED_CHILD_SECTION && linkedChildTxn && (
        <div className="flex flex-col gap-3 pt-4 border-t border-gray-300">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Linked Transaction</span>
            <p className="text-xs text-gray-500 mt-0.5">Linked to: {originalTxn.order_number}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                isRefundChild ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {isRefundChild ? 'CREDIT ADJUSTMENT' : 'ADJUSTMENT'}
            </span>
            <span className="text-sm font-semibold text-gray-900">{linkedChildTxn.order_number}</span>
            <Badge status={linkedChildTxn.transaction_status} />
          </div>

          <InfoRow label="Created" value={formatDateTime(linkedChildTxn.created_at)} />
          <RoleRow role="Payment" name={linkedChildTxn.payment_user_name} timestamp={linkedChildTxn.payment_at} />

          <VoidInfoBlock voidInfo={linkedChildTxn.void_info} />

          {!isRefundChild && linkedChildTxn.payment_entries?.length > 0 && (
            <div>
              <SectionHeading>Payment Entries</SectionHeading>
              <PaymentEntriesBlock
                entries={linkedChildTxn.payment_entries}
                cashTendered={linkedChildTxn.cash_tendered}
                changeGiven={linkedChildTxn.change_given}
                changeClaimed={linkedChildTxn.change_claimed}
              />
            </div>
          )}

          <div>
            <SectionHeading>Amount Summary</SectionHeading>
            {isRefundChild ? (
              <p className="text-sm text-gray-900">
                Added to customer credit record: {formatCurrency(linkedChildTxn.total_due)}
              </p>
            ) : (
              <div className="flex flex-col">
                <InfoRow label="Amount Due" value={formatCurrency(linkedChildTxn.total_due)} />
                {linkedChildTxn.remaining_balance_added != null && (
                  <InfoRow
                    label="Remaining Balance Added"
                    value={formatCurrency(linkedChildTxn.remaining_balance_added)}
                  />
                )}
                <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
                  <span>Total Due</span>
                  <span>{formatCurrency(linkedChildTxn.total_due)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Standalone Details column for a "View Details" click directly on an
// adjustment child's own row (Transaction History lists adjustment/refund
// children as their own rows, not just nested under their parent) — reuses
// the same field mappings as the nested Section B view above (Handled By,
// Customer, Payment Entries, Amount Summary), restructured as a full
// standalone column with its own header. Refund/credit-adjustment standalone
// view is a separate, not-yet-built layout — this only covers
// transaction_type === 'adjustment'.
function AdjustmentChildDetailsColumn({ childTxn, parentTxn }) {
  const { data: customer } = useCustomer(childTxn?.customer_id)
  if (!childTxn) return null

  const customerTypeBadge = CUSTOMER_TYPE_BADGE[childTxn.customer_type]

  // The variance that caused this adjustment lives on the ORIGINAL (parent)
  // transaction, not the child — same balance_due field OriginalAmountSummary
  // used before its own variance line was removed, so the amount here is
  // guaranteed to equal this child's own total_due/Amount Due below.
  const parentHasVariance =
    parentTxn?.actual_amount != null && Number(parentTxn.actual_amount) !== Number(parentTxn.estimated_amount)
  const parentBalanceDue = Number(parentTxn?.balance_due ?? 0)

  const sections = [
    childTxn.void_info && <VoidInfoBlock key="void" voidInfo={childTxn.void_info} />,
    <div key="adjustment-details">
      <SectionHeading>Adjustment Details</SectionHeading>
      <div className="flex flex-col">
        <InfoRow label="Estimated Amount" value={formatCurrency(parentTxn?.estimated_amount)} />
        <InfoRow label="Actual Amount" value={formatCurrency(parentTxn?.actual_amount)} />
        {parentHasVariance && (
          <p className={`text-sm font-medium py-0.5 ${parentBalanceDue > 0 ? 'text-amber-700' : 'text-blue-700'}`}>
            {parentBalanceDue > 0
              ? `+${formatCurrency(parentBalanceDue)} — item was heavier`
              : `-${formatCurrency(Math.abs(parentBalanceDue))} — item was lighter`}
          </p>
        )}
      </div>
    </div>,
    <div key="handled-by">
      <SectionHeading>Handled By</SectionHeading>
      <AdjustmentChildHandledBy t={childTxn} />
    </div>,
    <div key="customer">
      <SectionHeading>Customer</SectionHeading>
      <InfoRow label="Name" value={customer?.full_name ?? '...'} />
      <InfoRow label="Address" value={childTxn.customer_address ?? 'No address on file'} />
    </div>,
    childTxn.payment_entries?.length > 0 && (
      <div key="payment-entries">
        <SectionHeading>Payment Entries</SectionHeading>
        <PaymentEntriesBlock
          entries={childTxn.payment_entries}
          changeGiven={childTxn.change_given}
          changeClaimed={childTxn.change_claimed}
        />
      </div>
    ),
    <div key="amount-summary">
      <SectionHeading>Amount Summary</SectionHeading>
      <div className="flex flex-col">
        <InfoRow label="Amount Due" value={formatCurrency(childTxn.total_due)} />
        {Number(childTxn.credit_applied) > 0 && (
          <InfoRow label="Credit Applied" value={`-${formatCurrency(childTxn.credit_applied)}`} />
        )}
        {Number(childTxn.balance_settled) > 0 && (
          <InfoRow label="Balance Settled" value={`+${formatCurrency(childTxn.balance_settled)}`} />
        )}
        {childTxn.remaining_balance_added != null && (
          <InfoRow label="Remaining Balance Added" value={formatCurrency(childTxn.remaining_balance_added)} />
        )}
        <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
          <span>Total Due</span>
          <span>{formatCurrency(childTxn.total_due)}</span>
        </div>
      </div>
    </div>,
  ].filter(Boolean)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-gray-400 rounded-lg p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{childTxn.order_number}</span>
          <Badge status={childTxn.transaction_status} />
          {customerTypeBadge && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${customerTypeBadge.className}`}>
              {customerTypeBadge.label}
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            ADJUSTMENT
          </span>
          {parentTxn && (
            <span className="text-xs text-gray-500 ml-auto">
              Original Transaction: {parentTxn.order_number}
            </span>
          )}
        </div>

        {sections.flatMap((section, index) => [<Divider key={`divider-${index}`} />, section])}
      </div>
    </div>
  )
}

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

  // "View Details" can be opened directly on a child row (Transaction History
  // lists adjustment/refund children as their own rows) — the chain endpoint
  // always returns the full parent+child chain either way, so this finds which
  // specific row was actually clicked to decide whether to render the
  // standalone child layout instead of always defaulting to the parent's view.
  // Refund/credit-adjustment standalone view isn't built yet, so only
  // 'adjustment' switches to the new layout — a refund child falls through to
  // the existing originalTxn-centric rendering, unchanged.
  const viewedTxn = chain?.find((t) => t.id === transactionId) ?? null
  const isStandaloneAdjustmentChild = Boolean(
    viewedTxn?.parent_transaction_id != null && viewedTxn.transaction_type === 'adjustment'
  )

  // Scope guard for the unified single-card layout: exactly one parent
  // (original) + exactly one child, and that child must be an adjustment
  // ("customer owes more") or a refund ("store owes customer", always
  // resolved to credit) — both are pure total_due rows with no items of
  // their own. Any other chain shape (no children, multiple children,
  // etc.) falls through to the existing stacked rendering below, untouched.
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
    <FullScreenModal
      open={true}
      onClose={onClose}
      title="Transaction History"
      closeLabel="‹ Back"
      centerLabel={isStandaloneAdjustmentChild ? viewedTxn.order_number : originalTxn?.order_number}
    >
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
                  <ArticleTable>
                    <ArticleRows transaction={originalAsParent} variant="plain" align="center" />
                  </ArticleTable>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
              {isStandaloneAdjustmentChild ? (
                <AdjustmentChildDetailsColumn childTxn={viewedTxn} parentTxn={originalTxn} />
              ) : (
                <DetailsColumn originalTxn={originalTxn} linkedChildTxn={linkedChildTxn} />
              )}
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}
