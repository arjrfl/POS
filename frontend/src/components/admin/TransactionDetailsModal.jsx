import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { FullScreenModal } from '../ui/FullScreenModal'
import { Modal } from '../ui/Modal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Toast } from '../ui/Toast'
import { get } from '../../services/api'
import { useCustomer } from '../../hooks/useCustomer'
import { useReceiptPrint } from '../../hooks/useReceiptPrint'
import { ArticleRows, ARTICLE_ROW_COLUMN_WIDTHS } from '../payment/ArticleRows'
import { PrintDetailsModal } from '../receipt/PrintDetailsModal'
import { VoidTransactionModal } from './VoidTransactionModal'
import { VoidLogsModal } from './VoidLogsModal'
import { getTransactionTypeLabel } from '../../utils/transactionType'
import { CUSTOMER_TYPE_BADGE } from '../../utils/customerType'
import { PAYMENT_METHOD_LABEL } from '../../utils/paymentMethod'
import { formatCurrency } from '../../utils/format'
import { getDisplayStatus, isViewablePaymentStatus } from '../../utils/transactionStatus'

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

// Indented, bulleted sub-list of source order_numbers shown below a Balance
// Settled/Credit Applied row — one bullet per unique source, always bulleted
// (even a single source) for visual consistency. Omits entirely when there
// are no resolvable sources (legacy data pre-dating these fields).
function SourceOrderList({ sources }) {
  if (!sources?.length) return null
  return (
    <ul className="pl-4 pb-0.5 list-disc text-xs text-gray-700">
      {sources.map((orderNumber) => (
        <li key={orderNumber} className="font-semibold">
          {orderNumber}
        </li>
      ))}
    </ul>
  )
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

// Credit amounts read distinctly from Balance Settled's "+₱" — same green
// convention CustomersSection's NetBalanceCreditCell uses for NET CREDIT.
function CreditAppliedValue({ amount }) {
  return <span className="text-green-700 font-medium">{`-${formatCurrency(amount)}`}</span>
}

function OriginalAmountSummary({ t, hasLinkedAdjustment }) {
  return (
    <div className="flex flex-col">
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
        {Number(t.balance_settled) > 0 && (
          <>
            <InfoRow label="Balance Settled" value={`+${formatCurrency(t.balance_settled)}`} />
            <SourceOrderList sources={t.balance_settlement_sources} />
          </>
        )}
        {Number(t.credit_applied) > 0 && (
          <>
            <InfoRow label="Credit Applied" value={<CreditAppliedValue amount={t.credit_applied} />} />
            <SourceOrderList sources={t.credit_usage_sources} />
          </>
        )}
        {t.remaining_balance_added != null && (
          <InfoRow label="Remaining Balance Added" value={formatCurrency(t.remaining_balance_added)} />
        )}
        <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
          <span>Total Due</span>
          <span>{formatCurrency(t.total_due)}</span>
        </div>
      </div>

      <div className="flex flex-col mt-3 pt-2 border-t border-gray-200">
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
      </div>
    </div>
  )
}

// Merged role/name/timestamp row — a phase only ever shows up here once it's
// actually happened (timestamp not null), so an in-progress or voided-early
// transaction simply has fewer rows rather than blank ones. `extra` (optional)
// renders between the role label and the name — used by HandledByBlock's
// Payment row to place the "Order Items Update Logs" button.
function RoleRow({ role, name, timestamp, extra }) {
  if (!timestamp) return null
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-0.5">
      <span className="text-gray-500 shrink-0">{role}</span>
      <span className="flex items-baseline gap-2 min-w-0">
        {extra}
        <span className="text-gray-900 truncate">{name ?? '—'}</span>
        <span className="text-gray-500 text-xs shrink-0">{formatDateTime(timestamp)}</span>
      </span>
    </div>
  )
}

// Small, subtle ghost-style button shown next to the Payment row only, when
// items_edited_at_payment is true — edits only ever happen at Payment (see
// edit_transaction_items), never at Receiver or Releasing.
function OrderItemsUpdateLogsButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-xs text-gray-500 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-700"
    >
      Order Items Update Logs
    </button>
  )
}

// TODO: re-enable when working on Linked Adjustment Transaction details
const SHOW_LINKED_CHILD_SECTION = false

function HandledByBlock({ t, onShowItemLogs }) {
  if (!t.walkin_at && !t.payment_at && !t.releasing_at) return null
  return (
    <div className="flex flex-col">
      <RoleRow role="Receiver" name={t.walkin_user_name} timestamp={t.walkin_at} />
      <RoleRow
        role="Payment"
        name={t.payment_user_name}
        timestamp={t.payment_at}
        extra={t.items_edited_at_payment && <OrderItemsUpdateLogsButton onClick={onShowItemLogs} />}
      />
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
  // Same "Available once payment is processed" gate the Transaction History
  // list uses to disable its own "View Details" button (see TransactionRow's
  // isViewable) — a pending target has nothing to navigate to yet.
  const { status: paymentStatus } = getDisplayStatus(targetTxn)
  const isEligible = isViewablePaymentStatus(paymentStatus)

  return (
    <span className="text-xs text-gray-500 ml-auto">
      {label}:{' '}
      {onNavigate && isEligible ? (
        <button
          type="button"
          onClick={() => onNavigate(targetTxn.id)}
          className="text-brand-gold-dark font-bold underline cursor-pointer"
        >
          {targetTxn.order_number}
        </button>
      ) : (
        <span className="text-gray-400">
          {targetTxn.order_number}
          {!isEligible && ' (pending)'}
        </span>
      )}
    </span>
  )
}

// The Details column (right side) of the modal — Section A (the original
// transaction, always shown) plus Section B (a linked adjustment/refund
// child, only when one exists in the chain). Separate from the left-side
// Article Table, which keeps its own existing rendering untouched.
function DetailsColumn({ originalTxn, linkedChildTxn, onNavigate, onShowItemLogs }) {
  const { data: customer } = useCustomer(originalTxn?.customer_id)
  if (!originalTxn) return null

  const customerTypeBadge = CUSTOMER_TYPE_BADGE[originalTxn.customer_type]
  const isRefundChild = linkedChildTxn?.transaction_type === 'refund'

  // Built as a list (rather than inline JSX) so a divider can be placed before
  // each section without ever landing before one that didn't render (e.g. Void
  // Info on a non-voided transaction) — filter(Boolean) drops those first.
  const sectionsA = [
    originalTxn.void_info && <VoidInfoBlock key="void" voidInfo={originalTxn.void_info} />,
    <div key="customer">
      <SectionHeading>Customer</SectionHeading>
      <InfoRow label="Name" value={customer?.full_name ?? '...'} />
      <InfoRow label="Address" value={originalTxn.customer_address ?? 'No address on file'} />
    </div>,
    <div key="handled-by">
      <SectionHeading>Handled By</SectionHeading>
      <HandledByBlock t={originalTxn} onShowItemLogs={onShowItemLogs} />
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-4 flex flex-col gap-4">
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
    <div key="customer">
      <SectionHeading>Customer</SectionHeading>
      <InfoRow label="Name" value={customer?.full_name ?? '...'} />
      <InfoRow label="Address" value={childTxn.customer_address ?? 'No address on file'} />
    </div>,
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
    childTxn.payment_entries?.length > 0 && (
      <div key="payment-entries">
        <SectionHeading>Payment Entries</SectionHeading>
        <PaymentEntriesBlock entries={childTxn.payment_entries} />
      </div>
    ),
    <div key="amount-summary">
      <SectionHeading>Amount Summary</SectionHeading>
      <div className="flex flex-col">
        <div className="flex flex-col">
          <InfoRow label="Amount Due" value={formatCurrency(childTxn.total_due)} />
          {Number(childTxn.balance_settled) > 0 && (
            <>
              <InfoRow label="Balance Settled" value={`+${formatCurrency(childTxn.balance_settled)}`} />
              <SourceOrderList sources={childTxn.balance_settlement_sources} />
            </>
          )}
          {Number(childTxn.credit_applied) > 0 && (
            <>
              <InfoRow label="Credit Applied" value={<CreditAppliedValue amount={childTxn.credit_applied} />} />
              <SourceOrderList sources={childTxn.credit_usage_sources} />
            </>
          )}
          {childTxn.remaining_balance_added != null && (
            <InfoRow label="Remaining Balance Added" value={formatCurrency(childTxn.remaining_balance_added)} />
          )}
          <div className="flex justify-between text-sm font-bold pt-1.5 mt-1 border-t border-gray-300">
            <span>Total Due</span>
            <span>{formatCurrency(childTxn.total_due)}</span>
          </div>
        </div>

        <div className="flex flex-col mt-3 pt-2 border-t border-gray-200">
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
        </div>
      </div>
    </div>,
  ].filter(Boolean)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-4 flex flex-col gap-4">
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
    <div key="customer">
      <SectionHeading>Customer</SectionHeading>
      <InfoRow label="Name" value={customer?.full_name ?? '...'} />
      <InfoRow label="Address" value={childTxn.customer_address ?? 'No address on file'} />
    </div>,
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-4 flex flex-col gap-4">
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg">
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

// Synthetic item-table row(s) for a transaction's ledger-sourced balance
// settlement — see backend's balance_settlement_entries (distinct from
// balance_settlement_sources, which only powers the existing Amount Summary
// bullet list and is left untouched). Same shape/styling as ArticleRows'
// own NonProductRow so a balance_settlement-type transaction (zero real
// items) and a walk_in original that also settled an old balance (product
// rows + this) both read consistently. Rendered directly in this file rather
// than exported from ArticleRows.jsx since that component's own rendering
// path (items-driven, mechanism 1 only) stays untouched.
function BalanceSettlementRow({ entry, align }) {
  const alignClass = align === 'center' ? 'text-center' : ''
  const articleAlignClass = align === 'center' ? 'text-left' : ''
  return (
    <tr className="border-b border-gray-100 last:border-b-0 align-top">
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[0]} ${alignClass}`}>—</td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[1]} ${alignClass}`}>—</td>
      <td className={`py-2 pr-2 font-bold text-gray-900 ${ARTICLE_ROW_COLUMN_WIDTHS[2]} ${articleAlignClass}`}>
        {`Balance Settlement (Order #${entry.order_number})`}
      </td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[3]} ${alignClass}`}>—</td>
      <td className={`py-2 pr-2 font-medium text-gray-900 ${ARTICLE_ROW_COLUMN_WIDTHS[4]} ${alignClass}`}>
        {formatCurrency(entry.amount)}
      </td>
    </tr>
  )
}

function BalanceSettlementRows({ transaction, align }) {
  if (!transaction?.balance_settlement_entries?.length) return null
  return (
    <>
      {transaction.balance_settlement_entries.map((entry) => (
        <BalanceSettlementRow key={entry.order_number} entry={entry} align={align} />
      ))}
    </>
  )
}

// Print button shown directly below the Original transaction's item table —
// same shared useReceiptPrint flow as the Payment History tab's Print
// button. Always targets the ORIGINAL transaction, even when viewing a
// linked adjustment/refund child's own page (only the original carries real
// items + payment_entries suitable for the Order Slip form) — rendered
// unconditionally for any original-position transaction (transaction_type
// 'original' or 'balance_settlement', the only two types ever reachable as
// chain roots), regardless of item composition.
function PrintReceiptButton({ transaction }) {
  const { printing, showPrintDetails, openPrintDetails, closePrintDetails, handlePrintConfirm } = useReceiptPrint()
  if (!transaction) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start !px-3 !py-1 text-xs inline-flex items-center gap-1"
        disabled={printing}
        onClick={openPrintDetails}
      >
        <Printer size={14} />
        Print
      </Button>
      <PrintDetailsModal
        open={showPrintDetails}
        onClose={closePrintDetails}
        onConfirm={(tin, busStyle) => handlePrintConfirm(transaction.id, tin, busStyle)}
      />
    </>
  )
}

// True when an item still carries a valid (non-cleared) breakdown from
// Receiver's Tabulation modal — see database/schema.sql's tabulation_breakdown
// column comment. Payment's Edit Items clears this to NULL the moment
// quantity_kg is actually changed (see edit_transaction_items), so an empty
// array is never stored, but the length check is kept as a defensive floor.
function hasTabulationBreakdown(item) {
  return Array.isArray(item.tabulation_breakdown) && item.tabulation_breakdown.length > 0
}

// Print + (conditionally) Tabulation Logs, side by side — same shared
// originalTxn.items list backs both the existence check here and the modal's
// own left-column list, so they can never disagree about which transaction
// has tabulation data. Void/Void Logs (admin-only exception to "a completed
// transaction is immutable" — see CLAUDE.md) sits on the opposite side of the
// same row: a completed transaction gets a red Void button, a voided one gets
// Void Logs instead (never both), anything else gets neither.
function TransactionActionButtons({ transaction, hasTabulationLogs, onShowTabulationLogs, onVoid, onShowVoidLogs }) {
  if (!transaction) return null
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <PrintReceiptButton transaction={transaction} />
        {hasTabulationLogs && (
          <Button
            type="button"
            variant="outline"
            className="self-start !px-3 !py-1 text-xs inline-flex items-center gap-1"
            onClick={onShowTabulationLogs}
          >
            Tabulation Logs
          </Button>
        )}
      </div>
      {transaction.transaction_status === 'completed' && (
        <Button
          type="button"
          variant="danger"
          className="self-start !px-3 !py-1 text-xs"
          onClick={onVoid}
        >
          Void
        </Button>
      )}
      {transaction.transaction_status === 'voided' && (
        <Button
          type="button"
          variant="outline"
          className="self-start !px-3 !py-1 text-xs"
          onClick={onShowVoidLogs}
        >
          Void Logs
        </Button>
      )}
    </div>
  )
}

// Left column row — one per tabulated item. "Show" loads that item's
// breakdown into the right column; the active row gets a highlighted
// background so it's clear which item the right column is currently showing.
function TabulationLogsListRow({ item, isSelected, onShow }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md border ${
        isSelected ? 'bg-brand-gold/10 border-brand-gold' : 'bg-white border-gray-200'
      }`}
    >
      <div className="min-w-0">
        <div className="font-medium text-gray-900 truncate">{item.product_name}</div>
        {item.brand_name && <div className="text-xs text-gray-500 truncate">{item.brand_name}</div>}
      </div>
      <Button
        type="button"
        variant="outline"
        className="!px-2 !py-1 text-xs shrink-0"
        onClick={onShow}
      >
        Show
      </Button>
    </div>
  )
}

// Right column — read-only Row 1..N + Total for whichever item is currently
// selected in the left column. No inputs/edit/delete anywhere in this modal;
// it's a log viewer, not an editor. When the selected item's quantity_kg was
// later changed by Payment's Edit Items (tabulation_edited_by_payment),
// the breakdown/total above are still the original tabulated values — this
// note + link (reusing the exact same Order Items Update Logs trigger as
// the Handled By section, via onShowItemLogs) is how that staleness surfaces.
function TabulationLogsDetail({ item, receiverName, onShowItemLogs }) {
  if (!item) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-gray-500">Select an item to view its tabulation entries.</p>
      </div>
    )
  }

  const breakdown = item.tabulation_breakdown ?? []
  const total = breakdown.reduce((sum, value) => sum + Number(value), 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm">
        <span className="font-medium text-gray-900">{item.product_name}</span>
        {item.brand_name && <span className="text-gray-500"> — {item.brand_name}</span>}
      </div>
      {/* Same walkin_user_name already shown in Handled By's Receiver row —
          tabulation only ever happens during that same Receiver session, so
          no separate backend field/query is needed here. */}
      <div className="text-xs text-gray-500">Receiver: {receiverName ?? '—'}</div>
      <div className="text-xs text-gray-500">Unit Count: {item.unit_count}</div>
      <div className="flex flex-col mt-1">
        {breakdown.map((value, index) => (
          <div key={index} className="flex justify-between text-sm py-1 border-b border-gray-200">
            <span className="text-gray-600">Unit {index + 1}</span>
            <span className="text-gray-900">{Number(value).toFixed(3)} kg</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-bold pt-2 mt-1 border-t border-gray-300">
          <span>Total</span>
          <span>{total.toFixed(3)} kg</span>
        </div>
      </div>

      {item.tabulation_edited_by_payment && (
        <div className="flex flex-col items-start gap-1.5 mt-2 pt-2 border-t border-gray-200">
          <p className="text-xs text-amber-700">Payment updated this item's quantity after tabulation.</p>
          <OrderItemsUpdateLogsButton onClick={onShowItemLogs} />
        </div>
      )}
    </div>
  )
}

// items here is always the pre-filtered tabulated-only list (see
// tabulatedItems in TransactionDetailsModal) — this modal never has to
// re-derive which items qualify. onShowItemLogs is the same
// setItemLogsOpen(true) trigger DetailsColumn's Handled By section uses —
// lifted to the common parent (TransactionDetailsModal) so both open the
// exact same OrderItemsUpdateLogsModal instance rather than each building
// their own.
function TabulationLogsModal({ items, open, onClose, receiverName, onShowItemLogs }) {
  const [selectedItemId, setSelectedItemId] = useState(null)

  useEffect(() => {
    if (open) setSelectedItemId(null)
  }, [open])

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null

  return (
    <Modal open={open} onClose={onClose} title="Tabulation Logs" size="lg">
      <div className="flex-1 min-h-0 flex gap-[10px]">
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-2">
          {items.map((item) => (
            <TabulationLogsListRow
              key={item.id}
              item={item}
              isSelected={item.id === selectedItemId}
              onShow={() => setSelectedItemId(item.id)}
            />
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg p-3">
          <TabulationLogsDetail item={selectedItem} receiverName={receiverName} onShowItemLogs={onShowItemLogs} />
        </div>
      </div>
    </Modal>
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

// One product-item row for the Order Items Update Logs modal's two tables —
// same QTY|UNIT|ARTICLES|UNIT PRICE|AMOUNT convention as ArticleRows, but a
// plain listing (no id, no actual_* variance fields, no diffing/highlighting
// — this data has neither), so it's a small dedicated row rather than
// reusing ArticleRows/useArticleRows.
function ItemEditHistoryRow({ item }) {
  return (
    <tr className="border-b border-gray-100 last:border-b-0 align-top">
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[0]}`}>
        {item.quantity_kg != null ? Number(item.quantity_kg).toFixed(3) : '—'}
      </td>
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[1]}`}>
        {item.unit_count ?? '—'}
      </td>
      <td className={`py-2 pr-2 text-left ${ARTICLE_ROW_COLUMN_WIDTHS[2]}`}>
        <div className="font-medium text-gray-900">{item.product_name ?? 'Unknown product'}</div>
        {item.brand_name && <div className="text-xs text-gray-500">{item.brand_name}</div>}
      </td>
      <td className={`py-2 pr-2 text-gray-700 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[3]}`}>
        {formatCurrency(item.unit_price)}
      </td>
      <td className={`py-2 pr-2 font-medium text-gray-900 text-center ${ARTICLE_ROW_COLUMN_WIDTHS[4]}`}>
        {formatCurrency(item.subtotal)}
      </td>
    </tr>
  )
}

// One side of the two-table comparison — items === null renders the
// "not recorded" message in place of a table (only reachable for the
// Original side, on a transaction edited before original_items_snapshot_archive
// existed — see ItemEditHistoryResponse).
function ItemEditHistoryTable({ title, items, notRecordedMessage }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 border border-brand-black/20 rounded-lg">
        {items === null ? (
          <p className="text-sm text-gray-500 p-3">{notRecordedMessage}</p>
        ) : (
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
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-sm text-gray-500 py-4">
                    No items.
                  </td>
                </tr>
              ) : (
                items.map((item, index) => <ItemEditHistoryRow key={index} item={item} />)
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// Fetches GET /transactions/{id}/item-edit-history on open — lazy-loaded,
// no request until the button is actually clicked. transactionId here is
// always the ORIGINAL transaction's id: this modal is only ever reachable
// via HandledByBlock's Payment row inside DetailsColumn, which only renders
// for the original transaction (see TransactionDetailsModal below).
function OrderItemsUpdateLogsModal({ transactionId, open, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setData(null)
    setError(null)
    setLoading(true)

    get(`/transactions/${transactionId}/item-edit-history`)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load item edit history')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, transactionId])

  return (
    <Modal open={open} onClose={onClose} title="Order Items Update Logs" size="xl">
      <div className="flex-1 min-h-0 flex flex-col">
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

        {!loading && !error && data && (
          <div className="flex-1 min-h-0 flex gap-[10px]">
            <ItemEditHistoryTable
              title="Original Items (from Receiver)"
              items={data.original_items}
              notRecordedMessage="Original item list wasn't recorded for this transaction (recorded before this feature was added)."
            />
            <ItemEditHistoryTable title="Updated Items (by Payment)" items={data.updated_items} />
          </div>
        )}
      </div>
    </Modal>
  )
}

export function TransactionDetailsModal({ transactionId, onClose, onNavigate }) {
  const [chain, setChain] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [itemLogsOpen, setItemLogsOpen] = useState(false)
  const [tabulationLogsOpen, setTabulationLogsOpen] = useState(false)
  const [voidModalOpen, setVoidModalOpen] = useState(false)
  const [voidLogsOpen, setVoidLogsOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (message, variant = 'info') => {
    setToast({ message, variant })
    window.setTimeout(() => setToast(null), 3500)
  }

  const loadChain = () => {
    let cancelled = false
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
  }

  useEffect(() => {
    setChain(null)
    return loadChain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId])

  // The chain's root — always parent_transaction_id === null. Almost always
  // transaction_type 'original', but a standalone balance_settlement
  // transaction (Receiver -> Payment -> completed, no Releasing, never has
  // children) is ALSO a root with no parent — matching on parent_transaction_id
  // rather than the literal 'original' type is what lets this modal render one
  // at all instead of leaving every section below blank.
  const originalTxn = chain?.find((t) => !t.parent_transaction_id)
  const linkedChildTxn = originalTxn
    ? chain?.find(
        (t) =>
          t.parent_transaction_id === originalTxn.id &&
          (t.transaction_type === 'adjustment' || t.transaction_type === 'refund')
      )
    : null
  const hasLinkedAdjustment = Boolean(linkedChildTxn)

  // Void's cascade set (see backend void_transaction/_collect_void_set) is the
  // original's own direct 'completed' children — surfaced as a warning in the
  // confirm modal before it happens. Once voided, those same children show up
  // as 'voided' instead — that's the set Void Logs lists alongside the parent.
  const voidCascadeChildren = originalTxn
    ? chain.filter((t) => t.parent_transaction_id === originalTxn.id && t.transaction_status === 'completed')
    : []
  const voidedChildren = originalTxn
    ? chain.filter((t) => t.parent_transaction_id === originalTxn.id && t.transaction_status === 'voided')
    : []

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
  // Unlike _build_parent_summary's own parent-items path (product-type only,
  // by design — see that function's comment), every item type is passed
  // through here unfiltered: this is the Original transaction's real,
  // complete item list, and balance_settlement/credit_usage rows need to
  // show up in it too (useArticleRows/ArticleRows render those distinctly).
  const originalAsParent = useMemo(() => {
    if (!originalTxn) return null
    return { parent: originalTxn }
  }, [originalTxn])

  // Backs both the Tabulation Logs button's existence check and the modal's
  // own left-column list — always sourced from the original's real item rows
  // (tabulation only ever happens at Receiver, on the original transaction).
  const tabulatedItems = useMemo(
    () => originalTxn?.items?.filter(hasTabulationBreakdown) ?? [],
    [originalTxn]
  )

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
                      preferActual={isStandaloneChild}
                    />
                    <BalanceSettlementRows transaction={originalTxn} align="center" />
                  </ArticleTable>
                  <TransactionActionButtons
                    transaction={originalTxn}
                    hasTabulationLogs={tabulatedItems.length > 0}
                    onShowTabulationLogs={() => setTabulationLogsOpen(true)}
                    onVoid={() => setVoidModalOpen(true)}
                    onShowVoidLogs={() => setVoidLogsOpen(true)}
                  />
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
                        preferActual={isStandaloneChild}
                      />
                      <BalanceSettlementRows transaction={originalTxn} align="center" />
                    </ArticleTable>
                    <TransactionActionButtons
                      transaction={originalTxn}
                      hasTabulationLogs={tabulatedItems.length > 0}
                      onShowTabulationLogs={() => setTabulationLogsOpen(true)}
                      onVoid={() => setVoidModalOpen(true)}
                      onShowVoidLogs={() => setVoidLogsOpen(true)}
                    />
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
                    <ArticleRows transaction={originalAsParent} variant="plain" align="center" preferActual={false} />
                    <BalanceSettlementRows transaction={originalTxn} align="center" />
                  </ArticleTable>
                  <TransactionActionButtons
                    transaction={originalTxn}
                    hasTabulationLogs={tabulatedItems.length > 0}
                    onShowTabulationLogs={() => setTabulationLogsOpen(true)}
                    onVoid={() => setVoidModalOpen(true)}
                    onShowVoidLogs={() => setVoidLogsOpen(true)}
                  />
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
                <DetailsColumn
                  originalTxn={originalTxn}
                  linkedChildTxn={linkedChildTxn}
                  onNavigate={onNavigate}
                  onShowItemLogs={() => setItemLogsOpen(true)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <OrderItemsUpdateLogsModal
        transactionId={transactionId}
        open={itemLogsOpen}
        onClose={() => setItemLogsOpen(false)}
      />

      <TabulationLogsModal
        items={tabulatedItems}
        open={tabulationLogsOpen}
        onClose={() => setTabulationLogsOpen(false)}
        receiverName={originalTxn?.walkin_user_name}
        onShowItemLogs={() => {
          // Close this modal before opening Order Items Update Logs so only
          // one is ever visible at a time — closing that one lands cleanly
          // back on the Transaction History detail view underneath, with no
          // need to reopen Tabulation Logs automatically.
          setTabulationLogsOpen(false)
          setItemLogsOpen(true)
        }}
      />

      <VoidTransactionModal
        open={voidModalOpen}
        transaction={originalTxn}
        childOrderNumbers={voidCascadeChildren.map((t) => t.order_number)}
        onClose={() => setVoidModalOpen(false)}
        onVoided={() => {
          loadChain()
          showToast('Transaction voided', 'success')
        }}
        onError={(message) => showToast(message, 'error')}
      />

      <VoidLogsModal
        open={voidLogsOpen}
        transaction={originalTxn}
        childTransactions={voidedChildren}
        onClose={() => setVoidLogsOpen(false)}
      />

      <Toast toast={toast} />
    </FullScreenModal>
  )
}
