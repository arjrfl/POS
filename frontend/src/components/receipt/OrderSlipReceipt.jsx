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
const ITEM_TABLE_ROWS = 22

// Matches the reference paper form: plain comma-separated number, no ₱
// symbol — distinct from the app-wide formatCurrency utility, which is for
// on-screen UI only.
const formatPlainAmount = (amount) =>
  Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function OrderSlipReceipt({ transaction }) {
  if (!transaction) return null

  const productItems = transaction.items.filter((item) => item.item_type === 'product')
  const fillerRowCount = Math.max(0, ITEM_TABLE_ROWS - productItems.length)

  return (
    <div className="order-slip bg-white text-black text-[11pt] leading-tight px-3 w-full min-h-[200mm] flex flex-col justify-between">
      <div className="text-center py-0 px-2">
        <div className="font-bold text-[14pt]">LASH FROZEN MEAT TRADING, INC.</div>
        <div className="text-[9pt]">112 Macabagdal St. Brgy. 86 Dist. II 1400 Caloocan City NCR, Third District Philippines</div>
        <div className="text-[9pt]">Non VAT Reg. TIN: 010-561-596-00000</div>
      </div>

      <div>
        <div className="flex justify-between items-baseline px-2 py-0">
          <span className="font-bold text-[13pt]">ORDER SLIP</span>
          <span>
            No. <span className="font-bold text-[13pt]">{transaction.order_number}</span>
          </span>
        </div>

        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[58%]" />
            <col className="w-[42%]" />
          </colgroup>
          <tbody>
            <tr>
              <td className="px-2 py-0">
                Customer Name: <span className="font-bold">{transaction.customer_name}</span>
              </td>
              <td className="px-2 py-0">
                DATE: <span className="font-bold">{formatReceiptDate(transaction.walkin_at)}</span>
              </td>
            </tr>
            <tr>
              <td rowSpan={2} className="px-2 py-0 align-top">
                Address: <span className="font-bold">{transaction.customer_address || ''}</span>
              </td>
              <td className="px-2 py-0">TIN:</td>
            </tr>
            <tr>
              <td className="px-2 py-0">BUS. STYLE:</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[13%]" />
          <col className="w-[9%]" />
          <col className="w-[41%]" />
          <col className="w-[20%]" />
          <col className="w-[17%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="px-1 py-0 text-left font-bold">QTY.</th>
            <th className="px-1 py-0 text-left font-bold">UNIT</th>
            <th className="px-1 py-0 text-left font-bold">ARTICLES</th>
            <th className="px-1 py-0 text-right font-bold whitespace-nowrap">UNIT PRICE</th>
            <th className="px-1 py-0 text-right font-bold whitespace-nowrap">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {productItems.map((item) => (
            <tr key={item.id}>
              <td className="px-1 py-0 align-top">{Number(item.quantity_kg).toFixed(3)}</td>
              <td className="px-1 py-0 align-top">{item.unit_count}</td>
              <td className="px-1 py-0 align-top break-words">
                <div>{item.brand_name ? `${item.product_name} ${item.brand_name}` : item.product_name}</div>
              </td>
              <td className="px-1 py-0 align-top text-right">{formatPlainAmount(item.unit_price)}</td>
              <td className="px-1 py-0 align-top text-right">{formatPlainAmount(item.subtotal)}</td>
            </tr>
          ))}
          {Array.from({ length: fillerRowCount }).map((_, i) => (
            <tr key={`filler-${i}`}>
              <td className="px-1 py-0">&nbsp;</td>
              <td className="px-1 py-0">&nbsp;</td>
              <td className="px-1 py-0">&nbsp;</td>
              <td className="px-1 py-0 text-right">&nbsp;</td>
              <td className="px-1 py-0 text-right">&nbsp;</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="px-1 py-0 text-right font-bold">
              TOTAL AMOUNT DUE
            </td>
            <td className="px-1 py-0 text-right font-bold">{formatPlainAmount(transaction.total_due)}</td>
          </tr>
        </tfoot>
      </table>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-1/2" />
          <col className="w-1/2" />
        </colgroup>
        <tbody>
          <tr>
            <td className="px-2 py-0 h-9 align-top">PREPARED BY:</td>
            <td rowSpan={2} className="px-2 py-0 align-top">
              <div>RECEIVED BY:</div>
              <div className="border-b border-black mt-3"></div>
              <div className="text-[8pt] flex justify-between">
                <span>Signature Over printed Name</span>
                <span>DATE:</span>
              </div>
            </td>
          </tr>
          <tr>
            <td className="px-2 py-0 h-9 align-top">APPROVED BY:</td>
          </tr>
        </tbody>
      </table>

      <div className="italic text-center text-[9pt]">Received the above goods in good order &amp; condition</div>
    </div>
  )
}
