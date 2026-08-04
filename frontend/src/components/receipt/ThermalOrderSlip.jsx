import { formatCurrency } from '../../utils/format'

// Plain, minimal thermal-printer layout — 80mm roll, natural height, no
// fixed row count/padding (unlike OrderSlipReceipt's 17-row A5 form match).
// Never rendered on screen; only shown inside #thermal-print-root during
// window.print() (see ThermalPrintLayer). Independent of OrderSlipReceipt —
// no TIN/business style/signature blocks.

// Deliberately distinct from formatReceiptDate (utils/time.js, "YYYY-MM-DD
// HH:MM:SS" for the A5 form) — this slip wants a compact human date like
// "Aug 4, 2026 3:45 PM".
const formatThermalDateTime = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function buildRows(transaction) {
  const items = transaction.items ?? []

  const rows = items
    .filter((item) => item.item_type !== 'credit_usage')
    .map((item) => {
      if (item.item_type === 'balance_settlement') {
        return {
          key: item.id,
          article: item.reference_order_number
            ? `Balance Settlement (${item.reference_order_number})`
            : 'Balance Settlement',
          brand: null,
          qty: '—',
          amount: formatCurrency(item.subtotal),
        }
      }
      return {
        key: item.id,
        article: item.product_name,
        brand: item.brand_name,
        qty: item.quantity_kg != null ? `${Number(item.quantity_kg).toFixed(3)} kg` : '—',
        amount: formatCurrency(item.subtotal),
      }
    })

  // Receiver's Balance Settlement Only flow creates the transaction with
  // zero items — the settled amount lives on transaction.total_due/
  // balance_settled, not as a transaction_item row (see create_transaction,
  // which rejects items entirely for transaction_type='balance_settlement').
  // Synthesize a single display row so the slip still shows what's being
  // settled instead of an empty item table.
  if (rows.length === 0 && transaction.transaction_type === 'balance_settlement') {
    rows.push({
      key: 'balance-settlement-synthetic',
      article: 'Balance Settlement',
      brand: null,
      qty: '—',
      amount: formatCurrency(transaction.total_due),
    })
  }

  return rows
}

export function ThermalOrderSlip({ transaction }) {
  if (!transaction) return null

  const rows = buildRows(transaction)
  const total =
    transaction.total_due != null
      ? Number(transaction.total_due)
      : (transaction.items ?? []).reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0)

  return (
    <div className="thermal-slip bg-white text-black text-[9pt] leading-snug w-full">
      <div className="px-1">
        <div>Order #: {transaction.order_number}</div>
        <div>Customer: {transaction.customer_name}</div>
        <div>Date &amp; Time: {formatThermalDateTime(transaction.walkin_at)}</div>
      </div>

      <div className="border-t border-dashed border-black my-1" />

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[50%]" />
          <col className="w-[20%]" />
          <col className="w-[30%]" />
        </colgroup>
        <thead>
          <tr className="font-bold">
            <td className="px-1 text-left">ARTICLE</td>
            <td className="px-1 text-center">QTY</td>
            <td className="px-1 text-right">AMOUNT</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-1 align-top">
                {row.article}
                {row.brand && <div className="text-[7pt] text-gray-600">{row.brand}</div>}
              </td>
              <td className="px-1 text-center align-top">{row.qty}</td>
              <td className="px-1 text-right align-top">{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-black my-1" />

      <div className="flex justify-between px-1 font-bold text-[10pt]">
        <span>TOTAL</span>
        <span>{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
