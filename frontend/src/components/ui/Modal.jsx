// 'md' (default) preserves the original compact confirm-dialog size exactly.
// 'lg' is for content-heavy modals (tables, multi-column layouts) that need
// a bounded height — flex flex-col here lets such content lay out a
// flex-shrink-0 header/footer around a flex-1 min-h-0 scrollable body.
const SIZE_CLASSES = {
  md: 'max-w-md',
  lg: 'max-w-4xl max-h-[80vh] flex flex-col',
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`bg-white rounded-lg shadow-lg w-full p-6 ${SIZE_CLASSES[size]}`}>
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            &#10005;
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
