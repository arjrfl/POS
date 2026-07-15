import { useMemo } from 'react'

// Builds display rows for an adjustment/refund child's article table. The
// child itself carries no items of its own (see resolve_substandard), so
// rows always come from transaction.parent.items — already product-type-only
// and carrying resolved product_name/brand_name from the backend. Shared by
// the Payment queue's Order Details panel and the Confirm Payment modal so
// the two views can't drift apart.
export function useArticleRows(transaction) {
  return useMemo(() => {
    const parentItems = transaction?.parent?.items ?? []

    const rows = parentItems.map((item) => {
      const actualQuantityKg = item.actual_quantity_kg != null ? Number(item.actual_quantity_kg) : null
      const quantityKg = Number(item.quantity_kg)
      const isAdjusted = actualQuantityKg != null && actualQuantityKg !== quantityKg

      return {
        id: item.id,
        product_name: item.product_name ?? `Product #${item.product_id}`,
        brand_name: item.brand_name,
        unit_count: item.unit_count,
        quantity_kg: quantityKg,
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal),
        actual_unit_count: item.actual_unit_count,
        actual_quantity_kg: actualQuantityKg,
        actual_subtotal: item.actual_subtotal != null ? Number(item.actual_subtotal) : null,
        isAdjusted,
      }
    })

    const unadjusted = rows.filter((row) => !row.isAdjusted)
    const adjusted = rows.filter((row) => row.isAdjusted)

    return { unadjusted, adjusted, hasAdjustments: adjusted.length > 0 }
  }, [transaction])
}
