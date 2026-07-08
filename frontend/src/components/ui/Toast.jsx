const VARIANT_STYLES = {
  info: 'bg-gray-900 text-white',
  error: 'bg-red-600 text-white',
  success: 'bg-green-600 text-white',
}

export function Toast({ toast }) {
  if (!toast) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]">
      <div className={`px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${VARIANT_STYLES[toast.variant] || VARIANT_STYLES.info}`}>
        {toast.message}
      </div>
    </div>
  )
}
