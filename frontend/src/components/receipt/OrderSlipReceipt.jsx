import { formatCurrency } from '../../utils/format'
import { formatReceiptDate } from '../../utils/time'

// Pure presentational Order Slip layout, print-only — plain black-on-white,
// pt-based sizing, full bordered/grid layout matching the physical paper
// form. Grid sections are real <table> markup (see .order-slip rules in
// index.css) rather than divs — border-collapse on div/flex borders does not
// reliably produce continuous grid lines in print. Never rendered on screen;
// only shown inside #receipt-print-root during window.print() (see
// ReceiptPrintLayer).
export function OrderSlipReceipt({ transaction }) {
  if (!transaction) return null

  const productItems = transaction.items.filter((item) => item.item_type === 'product')

  return (
    <div className="order-slip bg-white text-black text-[11pt] leading-tight p-4 w-full">
      <div className="text-center py-2 px-2">
        <div className="font-bold text-[14pt]">LASH FROZEN MEAT TRADING, INC.</div>
        <div className="text-[9pt]">112 Macabagdal St. Brgy. 86 Dist. II 1400 Caloocan City NCR, Third District Philippines</div>
        <div className="text-[9pt]">Non VAT Reg. TIN: 010-561-596-00000</div>
      </div>

      <div className="flex justify-between items-baseline px-2 py-1">
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
            <td className="px-2 py-1">
              Customer Name: <span className="font-bold">{transaction.customer_name}</span>
            </td>
            <td className="px-2 py-1">
              DATE: <span className="font-bold">{formatReceiptDate(transaction.walkin_at)}</span>
            </td>
          </tr>
          <tr>
            <td rowSpan={2} className="px-2 py-1 align-top">
              Address: <span className="font-bold">{transaction.customer_address || ''}</span>
            </td>
            <td className="px-2 py-1">TIN:</td>
          </tr>
          <tr>
            <td className="px-2 py-1">BUS. STYLE:</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[13%]" />
          <col className="w-[9%]" />
          <col className="w-[47%]" />
          <col className="w-[14%]" />
          <col className="w-[17%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="px-1 py-1 text-left font-bold">QTY.</th>
            <th className="px-1 py-1 text-left font-bold">UNIT</th>
            <th className="px-1 py-1 text-left font-bold">ARTICLES</th>
            <th className="px-1 py-1 text-right font-bold">UNIT PRICE</th>
            <th className="px-1 py-1 text-right font-bold">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {productItems.map((item) => (
            <tr key={item.id}>
              <td className="px-1 py-1 align-top">{Number(item.quantity_kg)}</td>
              <td className="px-1 py-1 align-top">{item.unit_count}</td>
              <td className="px-1 py-1 align-top break-words">
                <div className="font-bold">{item.product_name}</div>
                {item.brand_name && <div className="text-[9pt]">{item.brand_name}</div>}
              </td>
              <td className="px-1 py-1 align-top text-right">{formatCurrency(item.unit_price)}</td>
              <td className="px-1 py-1 align-top text-right">{formatCurrency(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="px-1 py-1 text-right font-bold">
              TOTAL AMOUNT DUE
            </td>
            <td className="px-1 py-1 text-right font-bold">{formatCurrency(transaction.total_due)}</td>
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
            <td className="px-2 py-1 h-12 align-top">
              <div>PREPARED BY:</div>
              <div>{transaction.walkin_user_name}</div>
            </td>
            <td rowSpan={2} className="px-2 py-1 align-bottom">
              <div>RECEIVED BY:</div>
              <div className="border-b border-black mt-6"></div>
              <div className="text-[8pt] text-center">Signature Over Printed Name / DATE:</div>
            </td>
          </tr>
          <tr>
            <td className="px-2 py-1 h-12 align-top">APPROVED BY:</td>
          </tr>
        </tbody>
      </table>

      <div className="italic text-center text-[9pt] mt-2">Received the above goods in good order &amp; condition</div>
    </div>
  )
}
