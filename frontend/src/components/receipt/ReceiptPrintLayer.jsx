import { useEffect } from 'react'
import { useReceiptPrintStore } from '../../store/receiptPrintStore'
import { OrderSlipReceipt } from './OrderSlipReceipt'

// Mounted once at the app root (sibling to routed pages) — watches
// receiptPrintStore and drives window.print() whenever a transaction is set.
export function ReceiptPrintLayer() {
  const transaction = useReceiptPrintStore((state) => state.transaction)
  const clearPrint = useReceiptPrintStore((state) => state.clearPrint)

  useEffect(() => {
    if (!transaction) return

    window.onafterprint = clearPrint
    const frame = requestAnimationFrame(() => window.print())

    return () => cancelAnimationFrame(frame)
  }, [transaction, clearPrint])

  return (
    <div id="receipt-print-root" className="hidden print:block">
      <OrderSlipReceipt transaction={transaction} />
    </div>
  )
}
