export function FullScreenModal({ open, onClose, title, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xl"
          aria-label="Close"
        >
          &#10005;
        </button>
      </div>
      <div className="flex-1 min-h-0 p-6">{children}</div>
    </div>
  )
}
