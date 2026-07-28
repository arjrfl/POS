import { useState } from 'react'
import { get } from '../services/api'
import { useReceiptPrintStore } from '../store/receiptPrintStore'

const ADJUSTMENT_TYPES = new Set(['adjustment', 'refund'])

// Builds the linked adjustment/refund child's own printable page. The child
// itself carries no items of its own (see resolve_substandard) — its article
// table borrows the original's items with actual_* substituted for
// quantity_kg/unit_count/subtotal wherever Releasing recorded a variance,
// falling back to the original value for anything that didn't vary — same
// preferActual convention ArticleRows/useArticleRows already use elsewhere.
// Every other printable field (order_number, customer, payment breakdown,
// total_due) comes straight from the child's own full response.
function buildChildPrintable(childTxn, originalTxn) {
  return {
    ...childTxn,
    items: originalTxn.items.map((item) => ({
      ...item,
      quantity_kg: item.actual_quantity_kg ?? item.quantity_kg,
      unit_count: item.actual_unit_count ?? item.unit_count,
      subtotal: item.actual_subtotal ?? item.subtotal,
    })),
  }
}

// Shared "click Print -> collect TIN/BUS. STYLE via PrintDetailsModal ->
// fetch the full transaction (chain-aware) -> trigger the app-root
// ReceiptPrintLayer" flow. Used by both the Payment History tab and the
// Admin Transaction Details modal so neither duplicates this logic.
export function useReceiptPrint() {
  const triggerPrint = useReceiptPrintStore((state) => state.triggerPrint)
  const [showPrintDetails, setShowPrintDetails] = useState(false)
  const [printing, setPrinting] = useState(false)

  const handlePrintConfirm = async (transactionId, tin, busStyle) => {
    setPrinting(true)
    try {
      const fetched = await get(`/transactions/${transactionId}`)

      let originalTxn = fetched
      let childTxn = null

      if (ADJUSTMENT_TYPES.has(fetched.transaction_type) && fetched.parent_transaction_id != null) {
        // Printed from the child's own row — its own `.parent` is only a
        // lightweight summary (id/order_number/items, no customer or payment
        // fields), so the full original needs its own fetch.
        originalTxn = await get(`/transactions/${fetched.parent_transaction_id}`)
        childTxn = fetched
      } else {
        // Printed from the original — already fully enriched in `.children`
        // (see _build_transaction_response), no extra fetch needed.
        childTxn = fetched.children?.find((child) => ADJUSTMENT_TYPES.has(child.transaction_type)) ?? null
      }

      // Original first, child second — same page order regardless of which
      // of the two the user actually clicked Print on.
      const printables = childTxn ? [originalTxn, buildChildPrintable(childTxn, originalTxn)] : [originalTxn]
      triggerPrint(printables, tin, busStyle)
    } finally {
      setPrinting(false)
    }
  }

  return {
    printing,
    showPrintDetails,
    openPrintDetails: () => setShowPrintDetails(true),
    closePrintDetails: () => setShowPrintDetails(false),
    handlePrintConfirm,
  }
}
