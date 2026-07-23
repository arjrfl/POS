import { formatCurrency } from '../../utils/format'
import { useArticleRows } from '../../hooks/useArticleRows'

// Proportional column widths — kept in one place so every consumer's header
// (each wraps ArticleRows in its own <table>/<thead>, see ArticleRows'
// top-of-file comment) can mirror them exactly on its <th> cells. Paired with
// table-fixed on the consumer's <table>, this guarantees the header and every
// row below land on identical pixel-aligned columns regardless of content
// length (e.g. long product/brand names wrap within ARTICLE instead of
// pushing columns wider).
export const ARTICLE_ROW_COLUMN_WIDTHS = ['w-[15%]', 'w-[18%]', 'w-[21%]', 'w-[28%]', 'w-[18%]']

// Same light tint convention AdjustedRow already uses below for
// amber (customer owes more) / blue (store owes customer) — reused here so
// a highlighted row in the Original box reads consistently with that.
const HIGHLIGHT_BG = { amber: 'bg-amber-50', blue: 'bg-blue-50' }

function UnadjustedRow({ row, align, highlightedProductIds, highlightColor, preferActual = true }) {
  const alignClass = align === 'center' ? 'text-center' : ''
  const articleAlignClass = align === 'center' ? 'text-left' : ''
  const highlightClass = highlightedProductIds?.has(row.product_id) ? HIGHLIGHT_BG[highlightColor] ?? '' : ''
  const quantityKg = preferActual ? row.actual_quantity_kg ?? row.quantity_kg : row.quantity_kg
  const unitCount = preferActual ? row.actual_unit_count ?? row.unit_count : row.unit_count
  const subtotal = preferActual ? row.actual_subtotal ?? row.subtotal : row.subtotal
  return (
    <tr className={`border-b border-gray-100 last:border-b-0 align-top ${highlightClass}`}>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[0]} ${alignClass}`}>
        {quantityKg.toFixed(3)}
      </td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[1]} ${alignClass}`}>{unitCount}</td>
      <td className={`py-2 pr-2 ${ARTICLE_ROW_COLUMN_WIDTHS[2]} ${articleAlignClass}`}>
        <div className="font-medium text-gray-900">{row.product_name}</div>
        {row.brand_name && <div className="text-xs text-gray-500">{row.brand_name}</div>}
      </td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[3]} ${alignClass}`}>
        {formatCurrency(row.unit_price)}
      </td>
      <td className={`py-2 pr-2 font-medium text-gray-900 ${ARTICLE_ROW_COLUMN_WIDTHS[4]} ${alignClass}`}>
        {formatCurrency(subtotal)}
      </td>
    </tr>
  )
}

function AdjustedRow({ row, align }) {
  const alignClass = align === 'center' ? 'text-center' : ''
  const articleAlignClass = align === 'center' ? 'text-left' : ''
  const variance = row.actual_subtotal - row.subtotal
  const tint = variance > 0 ? 'bg-amber-50' : variance < 0 ? 'bg-blue-50' : ''
  const varianceClass = variance > 0 ? 'text-amber-700' : variance < 0 ? 'text-blue-700' : 'text-gray-700'
  const sign = variance > 0 ? '+' : variance < 0 ? '-' : ''

  return (
    <tr className={`border-b border-gray-100 last:border-b-0 align-top ${tint}`}>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[0]} ${alignClass}`}>
        {row.quantity_kg.toFixed(3)} &rarr; {row.actual_quantity_kg.toFixed(3)}
      </td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[1]} ${alignClass}`}>
        {row.unit_count} &rarr; {row.actual_unit_count}
      </td>
      <td className={`py-2 pr-2 ${ARTICLE_ROW_COLUMN_WIDTHS[2]} ${articleAlignClass}`}>
        <div className="font-medium text-gray-900">{row.product_name}</div>
        {row.brand_name && <div className="text-xs text-gray-500">{row.brand_name}</div>}
      </td>
      <td className={`py-2 pr-2 text-gray-700 ${ARTICLE_ROW_COLUMN_WIDTHS[3]} ${alignClass}`}>
        {formatCurrency(row.unit_price)}
      </td>
      <td className={`py-2 pr-2 font-medium ${varianceClass} ${ARTICLE_ROW_COLUMN_WIDTHS[4]} ${alignClass}`}>
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
//
// variant controls whether variance is marked at all — it's a context choice
// (which box/transaction this is being rendered for), not something the data
// itself should decide per item:
//   'adjusted' (default, existing behavior) — items whose quantity_kg differs
//     from actual_quantity_kg get an "Adjusted Items" heading + before/after
//     arrows + delta; unchanged items render plainly above that heading.
//   'plain' — every item renders with its actual value only, regardless of
//     whether a variance exists underneath (no heading, no arrows, no delta).
//
// highlightedProductIds (optional Set) + highlightColor ('amber' | 'blue') —
// a light row-background tint for plain rows whose product_id is in the
// set, with no heading/arrows/delta of its own. Used by the Original box
// in TransactionDetailsModal.jsx to flag which items a linked adjustment/
// refund child touched, without duplicating that child's before→after
// presentation.
//
// preferActual (default true) — whether an unadjusted row's displayed
// QTY/UNIT/AMOUNT fall back to actual_* when set. The Original transaction's
// own historical record (viewed directly, not reused as a child's "current
// reality" table) always wants its own input values instead — see
// TransactionDetailsModal.jsx's isStandaloneChild-gated preferActual prop.
export function ArticleRows({
  transaction,
  variant = 'adjusted',
  align = 'left',
  highlightedProductIds,
  highlightColor,
  preferActual = true,
}) {
  const { rows, unadjusted, adjusted, hasAdjustments } = useArticleRows(transaction)

  if (variant === 'plain') {
    return (
      <>
        {rows.map((row) => (
          <UnadjustedRow
            key={row.id}
            row={row}
            align={align}
            highlightedProductIds={highlightedProductIds}
            highlightColor={highlightColor}
            preferActual={preferActual}
          />
        ))}
      </>
    )
  }

  return (
    <>
      {unadjusted.map((row) => (
        <UnadjustedRow
          key={row.id}
          row={row}
          align={align}
          highlightedProductIds={highlightedProductIds}
          highlightColor={highlightColor}
          preferActual={preferActual}
        />
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
            <AdjustedRow key={row.id} row={row} align={align} />
          ))}
        </>
      )}
    </>
  )
}
