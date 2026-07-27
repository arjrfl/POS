import { useEffect, useRef } from 'react'

// 'md' (default) preserves the original compact confirm-dialog size exactly.
// 'lg' is for content-heavy modals (tables, multi-column layouts) that need
// a fixed, predictable height — h-[94vh] makes the box that tall regardless
// of content amount (rather than shrink-wrapping short content), and
// max-h-[94vh] alongside it is just a safety cap for viewports shorter than
// 94vh would otherwise allow. flex flex-col lets that fixed height be
// divided into a flex-shrink-0 header/footer around a flex-1 min-h-0 body.
// 'xl' is 'lg' widened ~15% (max-w-5xl's 64rem -> 74rem) for modals with two
// five-column tables side by side (e.g. Order Items Update Logs) that feel
// cramped at 'lg' — kept as its own variant rather than widening 'lg' itself,
// since EditItemsModal also uses 'lg' and doesn't need the extra width.
const SIZE_CLASSES = {
  md: 'max-w-md',
  lg: 'max-w-5xl h-[94vh] max-h-[94vh] flex flex-col',
  xl: 'max-w-[74rem] h-[94vh] max-h-[94vh] flex flex-col',
}

// Module-level stack of currently-open Modal instances (by mount order), so
// that when one Modal is opened on top of another (e.g. a confirmation
// popup stacked over a parent modal), Escape only dismisses the topmost one
// instead of cascading through every open Modal's own keydown listener.
let openModalStack = []

export function Modal({ open, onClose, title, children, size = 'md' }) {
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = Symbol('modal')

  useEffect(() => {
    if (!open) return undefined
    const id = idRef.current
    openModalStack.push(id)
    return () => {
      openModalStack = openModalStack.filter((stackId) => stackId !== id)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (openModalStack[openModalStack.length - 1] !== idRef.current) return
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-lg w-full p-6 ${SIZE_CLASSES[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 flex-shrink-0 -mx-6 -mt-6 px-6 py-4 bg-brand-black text-brand-white rounded-t-lg">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          <button onClick={onClose} className="text-brand-white/70 hover:text-brand-gold" aria-label="Close">
            &#10005;
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
