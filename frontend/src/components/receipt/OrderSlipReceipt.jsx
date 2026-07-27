import { formatCurrency } from '../../utils/format'
import { formatReceiptDate } from '../../utils/time'

// Pure presentational Order Slip layout, print-only — plain black-on-white,
// pt-based sizing so it matches the physical paper slip regardless of screen
// theme. Never rendered on screen; only shown inside #receipt-print-root
// during window.print() (see ReceiptPrintLayer).
export function OrderSlipReceipt({ transaction }) {
  if (!transaction) return null

  const productItems = transaction.items.filter((item) => item.item_type === 'product')

  return (
    <div className="bg-white text-black text-[12pt] leading-snug p-6 w-full">
      <div className="text-center mb-3">
        <div className="font-bold text-[14pt]">LASH FROZEN MEAT TRADING, INC.</div>
        <div>112 Macabagdal St. Brgy. 86 Dist. II 1400 Caloocan City NCR, Third District Philippines</div>
        <div>Non VAT Reg. TIN: 010-561-596-00000</div>
      </div>

      <div className="flex justify-between mb-1">
        <span className="font-bold">ORDER SLIP</span>
        <span>No. {transaction.order_number}</span>
      </div>

      <div className="flex justify-between mb-1">
        <span>Customer Name: {transaction.customer_name}</span>
        <span>DATE: {formatReceiptDate(transaction.walkin_at)}</span>
      </div>

      <div className="flex justify-between mb-3">
        <span>Address: {transaction.customer_address || ''}</span>
        <span>TIN:</span>
        <span>BUS. STYLE:</span>
      </div>

      <table className="w-full border-collapse mb-3">
        <thead>
          <tr className="border-t border-b border-black">
            <th className="text-left py-1 pr-2 font-bold">QTY</th>
            <th className="text-left py-1 pr-2 font-bold">UNIT</th>
            <th className="text-left py-1 pr-2 font-bold">ARTICLES</th>
            <th className="text-right py-1 pr-2 font-bold">UNIT PRICE</th>
            <th className="text-right py-1 font-bold">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {productItems.map((item) => (
            <tr key={item.id}>
              <td className="py-1 pr-2 align-top">{Number(item.quantity_kg)}</td>
              <td className="py-1 pr-2 align-top">{item.unit_count}</td>
              <td className="py-1 pr-2 align-top">
                <div className="font-bold">{item.product_name}</div>
                {item.brand_name && <div className="text-[10pt]">{item.brand_name}</div>}
              </td>
              <td className="py-1 pr-2 align-top text-right">{formatCurrency(item.unit_price)}</td>
              <td className="py-1 align-top text-right">{formatCurrency(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-right font-bold mb-6">TOTAL AMOUNT DUE: {formatCurrency(transaction.total_due)}</div>

      <div className="flex justify-between mb-2">
        <div>
          <div>PREPARED BY:</div>
          <div className="mt-4">{transaction.walkin_user_name}</div>
        </div>
        <div className="text-right">
          <div>RECEIVED BY:</div>
          <div className="mt-6 border-t border-black w-56 inline-block"></div>
          <div>Signature Over Printed Name / DATE:</div>
        </div>
      </div>

      <div className="italic text-[10pt] mt-4">Received the above goods in good order &amp; condition</div>
    </div>
  )
}
