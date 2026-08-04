// Print-only Tabulation Logs page, appended after the Order Slip page(s)
// when a transaction has tabulated items (see buildTabulationLogsPageEntry
// in utils/tabulation.js). Reuses the `order-slip` wrapper class for the
// page container (page-break-inside: avoid, same as OrderSlipReceipt's
// outer wrapper) so it behaves the same as any other printed page, but its
// own layout (header/rows/cards) is plain — no bordered grid tables like
// OrderSlipReceipt, since this page has no physical paper-form equivalent
// to match.
//
// Field paths below match OrderSlipReceipt.jsx exactly, confirmed by
// reading it first:
// - ARTICLES: item.product_name / item.brand_name (OrderSlipReceipt joins
//   them with a space and falls back to product_name alone when brand_name
//   is empty; this page instead joins with " - " per the approved mockup,
//   same fallback-when-empty behavior)
// - Receiver/staff attribution: transaction.walkin_user_name — already
//   used identically as the "Receiver" row in TransactionDetailsModal.jsx
//   (both the Handled By section and the receiverName prop passed into the
//   admin-side TabulationLogsModal viewer)

function getUnitCount(item) {
  return item.unit_count || item.tabulation_breakdown.length
}

function getArticleLabel(item) {
  return item.brand_name ? `${item.product_name} - ${item.brand_name}` : item.product_name
}

export function TabulationLogsReceipt({ orderNumber, receiverName, items }) {
  return (
    <div className="order-slip bg-white text-black text-[10pt] leading-tight w-full">
      <div className="text-center py-0 px-2">
        <div className="font-bold text-[13pt]">Tabulation Logs</div>
      </div>

      <div className="mt-[2pt] px-2">
        <div className="flex justify-between items-baseline py-[1pt]">
          <span className="text-[8pt]">Order #:</span>
          <span className="font-bold text-[10pt]">{orderNumber}</span>
        </div>
        <div className="flex justify-between items-baseline py-[1pt]">
          <span className="text-[8pt]">Receiver:</span>
          <span className="font-bold text-[10pt]">{receiverName || ''}</span>
        </div>
      </div>

      <div className="mt-[4pt] px-2">
        {items.map((item) => {
          const total = item.tabulation_breakdown.reduce((sum, v) => sum + Number(v), 0)
          return (
            <div key={item.id} className="tabulation-item-card border border-black/40 rounded p-2 mb-3">
              <div className="text-[8pt]">Unit Count: {getUnitCount(item)}</div>
              <div className="font-bold text-[10pt] mt-[1pt]">{getArticleLabel(item)}</div>
              <div className="mt-[2pt]">
                {item.tabulation_breakdown.map((value, index) => (
                  <div key={index} className="flex justify-between items-baseline text-[9pt] py-[0.5pt]">
                    <span>Unit {index + 1}</span>
                    <span>{Number(value).toFixed(3)} kg</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-baseline font-bold text-[10pt] border-t border-black/40 mt-[2pt] pt-[2pt]">
                <span>Total</span>
                <span>{total.toFixed(3)} kg</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
