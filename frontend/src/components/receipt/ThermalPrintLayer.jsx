import { useEffect } from 'react'
import { useThermalPrintStore } from '../../store/thermalPrintStore'
import { ThermalOrderSlip } from './ThermalOrderSlip'

const THERMAL_STYLE_ID = 'thermal-page-override'

// Mounted once at the app root (sibling to ReceiptPrintLayer) — watches
// thermalPrintStore and drives window.print() whenever transaction is set.
// Fully independent of ReceiptPrintLayer/receiptPrintStore: the 80mm sizing
// is applied by injecting a temporary <style> override into <head> for the
// duration of this print job only, then removing it in onafterprint — it
// never touches or conflicts with the static @page { size: A5 portrait }
// rule in index.css that the existing Order Slip flow relies on.
export function ThermalPrintLayer() {
  const transaction = useThermalPrintStore((state) => state.transaction)
  const clearThermalPrint = useThermalPrintStore((state) => state.clearThermalPrint)

  useEffect(() => {
    if (!transaction) return

    const style = document.createElement('style')
    style.id = THERMAL_STYLE_ID
    style.textContent = '@page { size: 80mm auto; margin: 2mm; }'
    document.head.appendChild(style)

    window.onafterprint = () => {
      document.getElementById(THERMAL_STYLE_ID)?.remove()
      clearThermalPrint()
    }
    const frame = requestAnimationFrame(() => window.print())

    return () => cancelAnimationFrame(frame)
  }, [transaction, clearThermalPrint])

  return (
    <div id="thermal-print-root" className="hidden print:block">
      {transaction && <ThermalOrderSlip transaction={transaction} />}
    </div>
  )
}
