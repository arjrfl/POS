import { useMemo } from 'react'

// Builds display rows for an adjustment/refund child's article table. The
// child itself carries no items of its own (see resolve_substandard), so
// rows always come from transaction.parent.items — for that path, always
// product-type-only (TransactionParentItemResponse carries no item_type at
// all — see _build_parent_summary) and carrying resolved product_name/
// brand_name from the backend. Also reused by Admin's TransactionDetailsModal
// for an ORIGINAL transaction's own item table (originalAsParent), where
// items DO come through unfiltered and can include balance_settlement/
// credit_usage rows (real TransactionItemResponse shape, item_type present)
// — handled below via the isNonProduct branch. Shared by the Payment queue's
// Order Details panel and the Confirm Payment modal so the views can't drift
// apart.
export function useArticleRows(transaction) {
  return useMemo(() => {
    const parentItems = transaction?.parent?.items ?? []

    const rows = parentItems.map((item) => {
      // item_type is absent entirely on TransactionParentItemResponse rows
      // (adjustment/refund child's parent-items path) — those default to
      // product. Only a real TransactionItemResponse (Original's own table)
      // ever carries an explicit non-product item_type.
      if (item.item_type != null && item.item_type !== 'product') {
        return {
          id: item.id,
          item_type: item.item_type,
          reference_order_number: item.reference_order_number ?? null,
          subtotal: Number(item.subtotal),
          isAdjusted: false,
        }
      }

      const actualQuantityKg = item.actual_quantity_kg != null ? Number(item.actual_quantity_kg) : null
      const quantityKg = Number(item.quantity_kg)
      const isAdjusted = actualQuantityKg != null && actualQuantityKg !== quantityKg

      return {
        id: item.id,
        item_type: 'product',
        product_id: item.product_id,
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

    return { rows, unadjusted, adjusted, hasAdjustments: adjusted.length > 0 }
  }, [transaction])
}
