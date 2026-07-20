import { useRef, useState } from 'react'
import { InventoryView } from '../inventory/InventoryView'
import { Toast } from '../ui/Toast'

export function ProductsSection() {
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  const showToast = (message, variant = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, variant })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="h-full min-h-0">
      <InventoryView showToast={showToast} />
      <Toast toast={toast} />
    </div>
  )
}
