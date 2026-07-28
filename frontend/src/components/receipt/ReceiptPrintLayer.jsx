import { useEffect } from 'react'
import { useReceiptPrintStore } from '../../store/receiptPrintStore'
import { OrderSlipReceipt } from './OrderSlipReceipt'

// Mounted once at the app root (sibling to routed pages) — watches
// receiptPrintStore and drives window.print() whenever transactions is
// non-empty. Renders one OrderSlipReceipt per entry, in array order, with a
// forced page break between pages when there are two (see .receipt-page-break
// in index.css) — a single-entry array renders exactly as a lone print job
// always has.
export function ReceiptPrintLayer() {
  const transactions = useReceiptPrintStore((state) => state.transactions)
  const tin = useReceiptPrintStore((state) => state.tin)
  const busStyle = useReceiptPrintStore((state) => state.busStyle)
  const clearPrint = useReceiptPrintStore((state) => state.clearPrint)

  const hasTransactions = transactions.length > 0

  useEffect(() => {
    if (!hasTransactions) return

    window.onafterprint = clearPrint
    const frame = requestAnimationFrame(() => window.print())

    return () => cancelAnimationFrame(frame)
  }, [transactions, hasTransactions, clearPrint])

  return (
    <div id="receipt-print-root" className="hidden print:block">
      {transactions.map((transaction, index) => (
        <div key={transaction.id} className={index < transactions.length - 1 ? 'receipt-page-break' : undefined}>
          <OrderSlipReceipt transaction={transaction} tin={tin} busStyle={busStyle} />
        </div>
      ))}
    </div>
  )
}
