import { formatCurrency } from '../../utils/format'
import { useArticleRows } from '../../hooks/useArticleRows'

function UnadjustedRow({ row }) {
  return (
    <tr className="border-b border-gray-100 last:border-b-0 align-top">
      <td className="py-2 pr-2 text-gray-700">{(row.actual_quantity_kg ?? row.quantity_kg).toFixed(3)}</td>
      <td className="py-2 pr-2 text-gray-700">{row.actual_unit_count ?? row.unit_count}</td>
      <td className="py-2 pr-2">
        <div className="font-medium text-gray-900">{row.product_name}</div>
        {row.brand_name && <div className="text-xs text-gray-500">{row.brand_name}</div>}
      </td>
      <td className="py-2 pr-2 text-gray-700">{formatCurrency(row.unit_price)}</td>
      <td className="py-2 pr-2 font-medium text-gray-900">{formatCurrency(row.actual_subtotal ?? row.subtotal)}</td>
    </tr>
  )
}

function AdjustedRow({ row }) {
  const variance = row.actual_subtotal - row.subtotal
  const tint = variance > 0 ? 'bg-amber-50' : variance < 0 ? 'bg-blue-50' : ''
  const varianceClass = variance > 0 ? 'text-amber-700' : variance < 0 ? 'text-blue-700' : 'text-gray-700'
  const sign = variance > 0 ? '+' : variance < 0 ? '-' : ''

  return (
    <tr className={`border-b border-gray-100 last:border-b-0 align-top ${tint}`}>
      <td className="py-2 pr-2 text-gray-700">
        {row.quantity_kg.toFixed(3)} &rarr; {row.actual_quantity_kg.toFixed(3)}
      </td>
      <td className="py-2 pr-2 text-gray-700">
        {row.unit_count} &rarr; {row.actual_unit_count}
      </td>
      <td className="py-2 pr-2">
        <div className="font-medium text-gray-900">{row.product_name}</div>
        {row.brand_name && <div className="text-xs text-gray-500">{row.brand_name}</div>}
      </td>
      <td className="py-2 pr-2 text-gray-700">{formatCurrency(row.unit_price)}</td>
      <td className={`py-2 pr-2 font-medium ${varianceClass}`}>
        <div>
          {formatCurrency(row.subtotal)} &rarr; {formatCurrency(row.actual_subtotal)}
        </div>
        <div className="text-xs">
          ({sign}
          {formatCurrency(Math.abs(variance))})
        </div>
      </td>
    </tr>
  )
}

// Article table rows for an adjustment/refund child — shared by the Payment
// queue's Order Details panel and the Confirm Payment modal so they can't
// render this differently. Meant to be placed inside a <tbody>, with the
// standard QTY | UNIT | ARTICLES | UNIT PRICE | AMOUNT header above it.
export function ArticleRows({ transaction }) {
  const { unadjusted, adjusted, hasAdjustments } = useArticleRows(transaction)

  return (
    <>
      {unadjusted.map((row) => (
        <UnadjustedRow key={row.id} row={row} />
      ))}
      {hasAdjustments && (
        <>
          <tr>
            <td
              colSpan={5}
              className="pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200"
            >
              Adjusted Items
            </td>
          </tr>
          {adjusted.map((row) => (
            <AdjustedRow key={row.id} row={row} />
          ))}
        </>
      )}
    </>
  )
}
