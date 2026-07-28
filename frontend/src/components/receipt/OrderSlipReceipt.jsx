import { formatReceiptDate } from '../../utils/time'

// Pure presentational Order Slip layout, print-only — plain black-on-white,
// pt-based sizing, full bordered/grid layout matching the physical paper
// form. Grid sections are real <table> markup (see .order-slip rules in
// index.css) rather than divs — border-collapse on div/flex borders does not
// reliably produce continuous grid lines in print. Never rendered on screen;
// only shown inside #receipt-print-root during window.print() (see
// ReceiptPrintLayer).
// Item table always shows this many body rows, padded with blank rows when
// short — matches the physical paper form's fixed row count. Never
// truncated: a transaction with more items than this just renders them all.
// 17 (not 22) because the tfoot below now carries 5 extra blank label rows
// (Partial Payment? / Amount Received / Amount Paid / Balance / Change)
// above TOTAL AMOUNT DUE — 17 + 5 keeps the form's total row budget at 22.
const ITEM_TABLE_ROWS = 17

// Matches the reference paper form: plain comma-separated number, no ₱
// symbol — distinct from the app-wide formatCurrency utility, which is for
// on-screen UI only.
const formatPlainAmount = (amount) =>
  Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Order numbers are PREFIX-YYYYMMDD-NNNN (e.g. TXN-20260726-0003). The
// printed slip drops the date segment (PREFIX-NNNN) since the DATE field
// already shows it — only strips when that middle segment is really an
// 8-digit date, so shorter formats (e.g. ONE-00020) print unchanged.
const formatOrderNumberForSlip = (orderNumber) => {
  const parts = orderNumber.split('-')
  if (parts.length === 3 && /^\d{8}$/.test(parts[1])) {
    return `${parts[0]}-${parts[2]}`
  }
  return orderNumber
}

export function OrderSlipReceipt({ transaction }) {
  if (!transaction) return null

  const productItems = transaction.items.filter((item) => item.item_type === 'product')
  const fillerRowCount = Math.max(0, ITEM_TABLE_ROWS - productItems.length)

  return (
    <div className="order-slip bg-white text-black text-[10pt] leading-tight w-full">
      <div className="text-center py-0 px-2">
        <div className="font-bold text-[13pt]">LASH FROZEN MEAT TRADING, INC.</div>
        <div className="text-[7pt]">112 Macabagdal St. Brgy. 86 Dist. II 1400 Caloocan City NCR, Third District Philippines</div>
        <div className="text-[7pt]">Non VAT Reg. TIN: 010-561-596-00000</div>
      </div>

      <div className="mt-[2pt]">
        <div className="flex justify-between items-baseline px-2 py-0">
          <span className="font-bold text-[11pt]">ORDER SLIP</span>
          <span className="text-[10pt] font-bold">
            No. <span className="text-[12pt]">{formatOrderNumberForSlip(transaction.order_number)}</span>
          </span>
        </div>

        {/* Two independent tables (not one table with a rowSpan) so the
            2-row left column and 3-row right column each get their own
            equal row-height distribution — a shared rowSpan cell would
            force Address's row to inherit the combined height of TIN +
            BUS. STYLE, making it visibly taller than Customer Name's row. */}
        <div className="grid items-stretch" style={{ gridTemplateColumns: '58% 42%' }}>
          <table className="table-fixed w-full h-full">
            <tbody>
              <tr>
                <td className="px-2 py-0">
                  <span className="text-[8pt]">Customer Name:</span>{' '}
                  <span className="font-bold text-[10pt]">{transaction.customer_name}</span>
                </td>
              </tr>
              <tr>
                <td className="px-2 py-0">
                  <span className="text-[8pt]">Address:</span>{' '}
                  <span className="font-bold text-[10pt]">{transaction.customer_address || ''}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <table className="table-fixed w-full h-full" style={{ borderLeft: 'none' }}>
            <tbody>
              <tr>
                <td className="px-2 py-[1pt]">
                  <span className="text-[8pt]">DATE:</span>{' '}
                  <span className="font-bold text-[10pt]">{formatReceiptDate(transaction.walkin_at)}</span>
                </td>
              </tr>
              <tr>
                <td className="px-2 py-[1pt] text-[8pt]">TIN:</td>
              </tr>
              <tr>
                <td className="px-2 py-[1pt] text-[8pt]">BUS. STYLE:</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full table-fixed mt-[4pt]">
        <colgroup>
          <col className="w-[13%]" />
          <col className="w-[9%]" />
          <col className="w-[41%]" />
          <col className="w-[20%]" />
          <col className="w-[17%]" />
        </colgroup>
        <thead>
          <tr className="text-[8pt]">
            <th className="px-1 py-[1.5pt] text-center font-bold">QTY</th>
            <th className="px-1 py-[1.5pt] text-center font-bold">UNIT</th>
            <th className="px-1 py-[1.5pt] text-center font-bold">ARTICLES</th>
            <th className="px-1 py-[1.5pt] text-center font-bold whitespace-nowrap">UNIT PRICE</th>
            <th className="px-1 py-[1.5pt] text-center font-bold whitespace-nowrap">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {productItems.map((item) => (
            <tr key={item.id}>
              <td className="px-1 py-[1.5pt] align-top text-center">{Number(item.quantity_kg).toFixed(3)}</td>
              <td className="px-1 py-[1.5pt] align-top text-center">{item.unit_count}</td>
              <td className="px-1 py-[1.5pt] align-top truncate">
                {item.brand_name ? `${item.product_name} ${item.brand_name}` : item.product_name}
              </td>
              <td className="px-1 py-[1.5pt] align-top text-right">{formatPlainAmount(item.unit_price)}</td>
              <td className="px-1 py-[1.5pt] align-top text-right">{formatPlainAmount(item.subtotal)}</td>
            </tr>
          ))}
          {Array.from({ length: fillerRowCount }).map((_, i) => (
            <tr key={`filler-${i}`}>
              <td className="px-1 py-[1.5pt]">&nbsp;</td>
              <td className="px-1 py-[1.5pt]">&nbsp;</td>
              <td className="px-1 py-[1.5pt]">&nbsp;</td>
              <td className="px-1 py-[1.5pt] text-right">&nbsp;</td>
              <td className="px-1 py-[1.5pt] text-right">&nbsp;</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {['Partial Payment?', 'Amount Received:', 'Amount Paid:', 'Balance:', 'Change:'].map((label) => (
            <tr key={label}>
              <td colSpan={4} className="px-1 py-[1.5pt] text-right text-[8pt]">
                {label}
              </td>
              <td className="px-1 py-[1.5pt]">&nbsp;</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} className="px-1 py-[1.5pt] text-right font-bold text-[8pt]">
              TOTAL AMOUNT DUE
            </td>
            <td className="px-1 py-[1.5pt] text-right font-bold text-[10pt]">{formatPlainAmount(transaction.total_due)}</td>
          </tr>
        </tfoot>
      </table>

      <table className="w-full table-fixed mt-[4pt]">
        <colgroup>
          <col className="w-1/2" />
          <col className="w-1/2" />
        </colgroup>
        <tbody className="text-[9pt]">
          <tr>
            <td className="px-2 py-0 h-9 align-top">PREPARED BY:</td>
            <td rowSpan={2} className="px-2 py-0 align-top relative">
              <div>RECEIVED BY:</div>
              <div className="text-[7pt] absolute bottom-0 left-0 right-0">Signature Over printed Name</div>
            </td>
          </tr>
          <tr>
            <td className="px-2 py-0 h-9 align-top">APPROVED BY:</td>
          </tr>
        </tbody>
      </table>

      <div className="italic font-bold text-right text-[8pt] mt-[4pt] px-2">Received the above goods in good order &amp; condition</div>
    </div>
  )
}
