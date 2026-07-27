import { formatCurrency } from '../../utils/format'
import { formatReceiptDate } from '../../utils/time'

// Pure presentational Order Slip layout, print-only — plain black-on-white,
// pt-based sizing, full bordered/grid layout matching the physical paper
// form. Never rendered on screen; only shown inside #receipt-print-root
// during window.print() (see ReceiptPrintLayer).
export function OrderSlipReceipt({ transaction }) {
  if (!transaction) return null

  const productItems = transaction.items.filter((item) => item.item_type === 'product')

  return (
    <div className="bg-white text-black text-[11pt] leading-tight p-4 w-full">
      <div className="border-2 border-black">
        <div className="text-center py-2 px-2">
          <div className="font-bold text-[14pt]">LASH FROZEN MEAT TRADING, INC.</div>
          <div className="text-[9pt]">112 Macabagdal St. Brgy. 86 Dist. II 1400 Caloocan City NCR, Third District Philippines</div>
          <div className="text-[9pt]">Non VAT Reg. TIN: 010-561-596-00000</div>
        </div>

        <div className="border-t-2 border-black flex justify-between px-2 py-1 font-bold">
          <span>ORDER SLIP</span>
          <span>No. {transaction.order_number}</span>
        </div>

        <div className="border-t-2 border-black grid grid-cols-2">
          <div className="border-r border-black flex flex-col">
            <div className="px-2 py-1 border-b border-black">
              Customer Name: <span className="font-bold">{transaction.customer_name}</span>
            </div>
            <div className="px-2 py-1 flex-1">
              Address: <span className="font-bold">{transaction.customer_address || ''}</span>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="px-2 py-1 border-b border-black">
              DATE: <span className="font-bold">{formatReceiptDate(transaction.walkin_at)}</span>
            </div>
            <div className="px-2 py-1 border-b border-black">TIN:</div>
            <div className="px-2 py-1">BUS. STYLE:</div>
          </div>
        </div>

        <table className="w-full border-collapse border-t-2 border-black table-fixed">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[39%]" />
            <col className="w-[19%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="border border-black px-1 py-1 text-left font-bold">QTY.</th>
              <th className="border border-black px-1 py-1 text-left font-bold">UNIT</th>
              <th className="border border-black px-1 py-1 text-left font-bold">ARTICLES</th>
              <th className="border border-black px-1 py-1 text-right font-bold">UNIT PRICE</th>
              <th className="border border-black px-1 py-1 text-right font-bold">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {productItems.map((item) => (
              <tr key={item.id}>
                <td className="border border-black px-1 py-1 align-top">{Number(item.quantity_kg)}</td>
                <td className="border border-black px-1 py-1 align-top">{item.unit_count}</td>
                <td className="border border-black px-1 py-1 align-top break-words">
                  <div className="font-bold">{item.product_name}</div>
                  {item.brand_name && <div className="text-[9pt]">{item.brand_name}</div>}
                </td>
                <td className="border border-black px-1 py-1 align-top text-right">
                  {formatCurrency(item.unit_price)}
                </td>
                <td className="border border-black px-1 py-1 align-top text-right">{formatCurrency(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="border border-black px-1 py-1 text-right font-bold">
                TOTAL AMOUNT DUE
              </td>
              <td className="border border-black px-1 py-1 text-right font-bold">
                {formatCurrency(transaction.total_due)}
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="border-t border-black grid grid-cols-2">
          <div className="border-r border-black flex flex-col">
            <div className="px-2 py-1 border-b border-black h-12">
              <div>PREPARED BY:</div>
              <div>{transaction.walkin_user_name}</div>
            </div>
            <div className="px-2 py-1 h-12">APPROVED BY:</div>
          </div>
          <div className="flex flex-col justify-end px-2 py-1">
            <div>RECEIVED BY:</div>
            <div className="border-b border-black mt-6"></div>
            <div className="text-[8pt] text-center">Signature Over Printed Name / DATE:</div>
          </div>
        </div>
      </div>

      <div className="italic text-center text-[9pt] mt-2">Received the above goods in good order &amp; condition</div>
    </div>
  )
}
