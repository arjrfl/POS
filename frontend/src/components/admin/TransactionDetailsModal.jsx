import { useEffect, useMemo, useState } from 'react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Badge } from '../ui/Badge'
import { get } from '../../services/api'
import { useCustomer } from '../../hooks/useCustomer'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'
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

function isCashEntry(entry) {
  return entry.payment_method_name === 'cash'
}

function sumPaymentEntries(entries) {
  if (!entries?.length) return 0
  return entries.reduce(
    (sum, entry) => sum + Number((isCashEntry(entry) ? entry.tendered_amount : entry.amount) ?? 0),
    0
  )
}

function PaymentEntriesBlock({ entries }) {
  if (!entries?.length) return null

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
            {formatCurrency(isCashEntry(entry) ? entry.tendered_amount : entry.amount)}
          </span>
        </div>
      ))}
    </div>
  )
}

function OriginalAmountSummary({ t, hasLinkedAdjustment }) {
  return (
    <div className="flex flex-col">
      <InfoRow label="Estimated Amount" value={formatCurrency(t.estimated_amount)} />
      {t.actual_amount != null && (
        <InfoRow
          label="Actual Amount"
          value={
            hasLinkedAdjustment ? (
              <span className="text-gray-500">— see Linked Transaction</span>
            ) : (
              formatCurrency(t.actual_amount)
            )
          }
        />
      )}
      {t.payment_entries?.length > 0 && (
        <InfoRow label="Total Payment Entries" value={formatCurrency(sumPaymentEntries(t.payment_entries))} />
      )}
      {Number(t.change_given) > 0 && (
        <>
          <InfoRow label="Change" value={formatCurrency(t.change_given)} />
          <InfoRow label="Change Taken by Customer?" value={t.change_claimed ? 'Yes' : 'No'} />
          {!t.change_claimed && (
            <InfoRow label="Added to Customer Credit Record" value={formatCurrency(t.change_given)} />
          )}
        </>
      )}
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

// Header row's "Linked Transaction: TXN-xxxxx" / "Original Transaction:
// TXN-xxxxx" reference — only the order number itself is clickable, styled
// like the existing text-primary/hover:underline links elsewhere in the app
// (see PaymentConfirmationModal's "Back" button), not a button. Reuses the
// same onNavigate the Transaction History table's own "View Details" click
// already calls (see TransactionsSection) — just invoked with the OTHER
// transaction's id instead of the row that was clicked.
function LinkedOrderLabel({ label, targetTxn, onNavigate }) {
  if (!targetTxn) return null
  return (
    <span className="text-xs text-gray-500 ml-auto">
      {label}:{' '}
      {onNavigate ? (
        <button
          type="button"
          onClick={() => onNavigate(targetTxn.id)}
          className="text-primary hover:underline cursor-pointer"
        >
          {targetTxn.order_number}
        </button>
      ) : (
        targetTxn.order_number
      )}
    </span>
  )
}

// The Details column (right side) of the modal — Section A (the original
// transaction, always shown) plus Section B (a linked adjustment/refund
// child, only when one exists in the chain). Separate from the left-side
// Article Table, which keeps its own existing rendering untouched.
function DetailsColumn({ originalTxn, linkedChildTxn, onNavigate }) {
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
        <PaymentEntriesBlock entries={originalTxn.payment_entries} />
      </div>
    ),
    <div key="amount-summary">
      <SectionHeading>Amount Summary</SectionHeading>
      <OriginalAmountSummary t={originalTxn} hasLinkedAdjustment={Boolean(linkedChildTxn)} />
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
          <LinkedOrderLabel label="Linked Transaction" targetTxn={linkedChildTxn} onNavigate={onNavigate} />
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
              <PaymentEntriesBlock entries={linkedChildTxn.payment_entries} />
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
function AdjustmentChildDetailsColumn({ childTxn, parentTxn, onNavigate }) {
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
          <InfoRow
            label="Amount Difference"
            value={
              <span className={parentBalanceDue > 0 ? 'text-amber-700' : 'text-blue-700'}>
                {parentBalanceDue > 0
                  ? `+${formatCurrency(parentBalanceDue)}`
                  : `-${formatCurrency(Math.abs(parentBalanceDue))}`}
              </span>
            }
          />
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
        <PaymentEntriesBlock entries={childTxn.payment_entries} />
      </div>
    ),
    <div key="amount-summary">
      <SectionHeading>Amount Summary</SectionHeading>
      <div className="flex flex-col">
        <InfoRow label="Amount Due" value={formatCurrency(childTxn.total_due)} />
        {childTxn.payment_entries?.length > 0 && (
          <InfoRow label="Total Payment Entries" value={formatCurrency(sumPaymentEntries(childTxn.payment_entries))} />
        )}
        {Number(childTxn.change_given) > 0 && (
          <>
            <InfoRow label="Change" value={formatCurrency(childTxn.change_given)} />
            <InfoRow label="Change Taken by Customer?" value={childTxn.change_claimed ? 'Yes' : 'No'} />
            {!childTxn.change_claimed && (
              <InfoRow label="Added to Customer Credit Record" value={formatCurrency(childTxn.change_given)} />
            )}
          </>
        )}
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
          <LinkedOrderLabel label="Original Transaction" targetTxn={parentTxn} onNavigate={onNavigate} />
        </div>

        {sections.flatMap((section, index) => [<Divider key={`divider-${index}`} />, section])}
      </div>
    </div>
  )
}

// Standalone Details column for a "View Details" click directly on a
// refund/credit-adjustment child's own row — same shell as
// AdjustmentChildDetailsColumn above (header row shape, Handled By via the
// shared AdjustmentChildHandledBy, Customer section, Article Table +
// ADJUSTED ITEMS reuse the same shared logic in TransactionDetailsModal
// below) but this resolution path goes through resolve-as-credit, not /pay
// — there's no payment_detail row at all, so Payment Entries + Amount
// Summary don't apply here. Replaced with CREDIT ADJUSTMENT DETAILS (the
// variance that caused it, sourced from the parent, same as the Adjustment
// child) and CREDIT RESOLUTION (the credit outcome itself). Deliberately a
// separate function rather than a branch inside AdjustmentChildDetailsColumn
// so that component's existing rendering path stays untouched.
function CreditAdjustmentChildDetailsColumn({ childTxn, parentTxn, onNavigate }) {
  const { data: customer } = useCustomer(childTxn?.customer_id)
  if (!childTxn) return null

  const customerTypeBadge = CUSTOMER_TYPE_BADGE[childTxn.customer_type]

  // Same source as AdjustmentChildDetailsColumn's parentHasVariance/
  // parentBalanceDue — the variance lives on the ORIGINAL, not the child.
  const parentHasVariance =
    parentTxn?.actual_amount != null && Number(parentTxn.actual_amount) !== Number(parentTxn.estimated_amount)
  const parentBalanceDue = Number(parentTxn?.balance_due ?? 0)

  const sections = [
    childTxn.void_info && <VoidInfoBlock key="void" voidInfo={childTxn.void_info} />,
    <div key="credit-adjustment-details">
      <SectionHeading>Credit Adjustment Details</SectionHeading>
      <div className="flex flex-col">
        <InfoRow label="Estimated Amount" value={formatCurrency(parentTxn?.estimated_amount)} />
        <InfoRow label="Actual Amount" value={formatCurrency(parentTxn?.actual_amount)} />
        {parentHasVariance && (
          <InfoRow
            label="Amount Difference"
            value={<span className="text-blue-700">-{formatCurrency(Math.abs(parentBalanceDue))}</span>}
          />
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
    <div key="credit-resolution">
      <SectionHeading>Credit Resolution</SectionHeading>
      <div className="flex flex-col">
        <InfoRow label="Amount Added to Credit" value={formatCurrency(childTxn.total_due)} />
        <InfoRow label="Resolved By" value={childTxn.payment_user_name} />
        <InfoRow label="Resolved At" value={formatDateTime(childTxn.payment_at)} />
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
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
            CREDIT ADJUSTMENT
          </span>
          <LinkedOrderLabel label="Original Transaction" targetTxn={parentTxn} onNavigate={onNavigate} />
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
// `footer` (optional) renders below the table but still inside the same
// bordered/rounded card — used by the standalone Adjustment child view's
// "Adjusted Items" section, which isn't itself table-row content.
function ArticleTable({ children, footer }) {
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
      {footer}
    </div>
  )
}

// Lists each of the original transaction's items that varied (quantity_kg
// and/or unit_count — see adjustedItemRows above), only shown on the
// standalone Adjustment child view alongside the highlighted rows in the
// table above. Independent QTY/UNIT arrows — a resolution can change either
// dimension without touching the other.
// One row per varied item, using the exact same column widths/alignment as
// the main table's own rows above (ARTICLE_ROW_COLUMN_WIDTHS, same
// py-2/pr-2 cell padding) — a second <table> rather than a free-form block,
// so the two stay pixel-aligned regardless of content length. Arrows only
// appear on the dimension that actually changed for THIS item (a resolution
// can adjust quantity_kg and unit_count independently).
function AdjustedItemRow({ item }) {
  const qtyChanged = item.actual_quantity_kg != null && Number(item.actual_quantity_kg) !== Number(item.quantity_kg)
  const unitChanged = item.actual_unit_count != null && item.actual_unit_count !== item.unit_count
  const actualSubtotal = item.actual_subtotal != null ? Number(item.actual_subtotal) : Number(item.subtotal)
  const subtotalChanged = actualSubtotal !== Number(item.subtotal)

  return (
    <tr className="border-b border-gray-100 last:border-b-0 align-top">
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[0]}`}>
        {qtyChanged
          ? `${Number(item.quantity_kg).toFixed(3)} → ${Number(item.actual_quantity_kg).toFixed(3)}`
          : Number(item.quantity_kg).toFixed(3)}
      </td>
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[1]}`}>
        {unitChanged ? `${item.unit_count} → ${item.actual_unit_count}` : item.unit_count}
      </td>
      <td className={`py-2 pr-2 text-left ${ARTICLE_ROW_COLUMN_WIDTHS[2]}`}>
        <div className="font-medium text-gray-900">{item.product_name}</div>
        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
      </td>
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[3]}`}>
        {formatCurrency(item.unit_price)}
      </td>
      <td className={`py-2 pr-2 font-medium text-gray-900 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[4]}`}>
        {subtotalChanged
          ? `${formatCurrency(item.subtotal)} → ${formatCurrency(actualSubtotal)}`
          : formatCurrency(item.subtotal)}
      </td>
    </tr>
  )
}

// Same "Adjusted Items" heading convention ArticleRows.jsx's own 'adjusted'
// variant already uses (colSpan={5} label row) — rendered in a second
// table-fixed <table> (matching the main one's w-full table-fixed text-sm)
// so both land on identical column boundaries without duplicating the
// QTY/UNIT/ARTICLES/UNIT PRICE/AMOUNT header itself.
function AdjustedItemsSection({ items }) {
  if (!items?.length) return null
  return (
    <table className="w-full table-fixed text-sm">
      {/* table-fixed derives column widths from the first row's cells — the
          "Adjusted Items" label below is a single colSpan={5} cell, which
          can't convey 5 individual widths, so an explicit colgroup is needed
          to keep this table's columns aligned with the main table above it. */}
      <colgroup>
        {ARTICLE_ROW_COLUMN_WIDTHS.map((widthClass, index) => (
          <col key={index} className={widthClass} />
        ))}
      </colgroup>
      <tbody>
        <tr>
          <td
            colSpan={5}
            className="pt-3 pb-1 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200"
          >
            Adjusted Items
          </td>
        </tr>
        {items.map((item) => (
          <AdjustedItemRow key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  )
}

export function TransactionDetailsModal({ transactionId, onClose, onNavigate }) {
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
  // specific row was actually clicked to decide whether to render a
  // standalone child layout instead of always defaulting to the parent's view.
  const viewedTxn = chain?.find((t) => t.id === transactionId) ?? null
  const isStandaloneAdjustmentChild = Boolean(
    viewedTxn?.parent_transaction_id != null && viewedTxn.transaction_type === 'adjustment'
  )
  const isStandaloneRefundChild = Boolean(
    viewedTxn?.parent_transaction_id != null && viewedTxn.transaction_type === 'refund'
  )
  const isStandaloneChild = isStandaloneAdjustmentChild || isStandaloneRefundChild

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

  // Which of the original's items actually varied — quantity_kg OR unit_count,
  // independently (a substandard resolution can adjust either dimension) —
  // broader than useArticleRows' own isAdjusted (quantity_kg only), since that
  // hook is built for the child's before→after item table, not this flag.
  // Only applied on a standalone child view (see isStandaloneChild below,
  // covers both Adjustment and Credit Adjustment/refund) — the original's
  // own view never highlights or lists these, regardless of whether a
  // linked child exists.
  const adjustedItemRows = useMemo(() => {
    if (!originalAsParent) return []
    return originalAsParent.parent.items.filter((item) => {
      const qtyChanged =
        item.actual_quantity_kg != null && Number(item.actual_quantity_kg) !== Number(item.quantity_kg)
      const unitChanged = item.actual_unit_count != null && item.actual_unit_count !== item.unit_count
      return qtyChanged || unitChanged
    })
  }, [originalAsParent])
  const highlightedProductIds = useMemo(
    () => new Set(adjustedItemRows.map((item) => item.product_id)),
    [adjustedItemRows]
  )
  const highlightColor = linkedChildTxn?.transaction_type === 'refund' ? 'blue' : 'amber'

  return (
    <FullScreenModal
      open={true}
      onClose={onClose}
      title="Transaction History"
      closeLabel="‹ Back"
      centerLabel={isStandaloneChild ? viewedTxn.order_number : originalTxn?.order_number}
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
                  <ArticleTable
                    footer={isStandaloneChild && <AdjustedItemsSection items={adjustedItemRows} />}
                  >
                    <ArticleRows
                      transaction={originalAsParent}
                      variant="plain"
                      align="center"
                      highlightedProductIds={isStandaloneChild ? highlightedProductIds : undefined}
                      highlightColor={highlightColor}
                    />
                  </ArticleTable>
                </div>
              ) : hasLinkedAdjustment ? (
                <>
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <span className="text-sm font-medium">Original - {originalTxn.order_number}</span>
                    <ArticleTable
                      footer={isStandaloneChild && <AdjustedItemsSection items={adjustedItemRows} />}
                    >
                      <ArticleRows
                        transaction={originalAsParent}
                        variant="plain"
                        align="center"
                        highlightedProductIds={isStandaloneChild ? highlightedProductIds : undefined}
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
                <AdjustmentChildDetailsColumn childTxn={viewedTxn} parentTxn={originalTxn} onNavigate={onNavigate} />
              ) : isStandaloneRefundChild ? (
                <CreditAdjustmentChildDetailsColumn
                  childTxn={viewedTxn}
                  parentTxn={originalTxn}
                  onNavigate={onNavigate}
                />
              ) : (
                <DetailsColumn originalTxn={originalTxn} linkedChildTxn={linkedChildTxn} onNavigate={onNavigate} />
              )}
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}
