export function FullScreenModal({ open, onClose, title, children, closeLabel, centerLabel, headerActions }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col">
      <div className="flex-shrink-0 relative flex items-center justify-between px-6 py-4 bg-brand-black text-brand-white">
        <h2 className="text-lg font-semibold">{title}</h2>
        {centerLabel && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-semibold">
            {centerLabel}
          </span>
        )}
        {headerActions ? (
          headerActions
        ) : closeLabel ? (
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-brand-white/70 hover:text-brand-gold"
          >
            {closeLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-brand-white/70 hover:text-brand-gold text-xl"
            aria-label="Close"
          >
            &#10005;
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 p-6">{children}</div>
    </div>
  )
}
