const VARIANTS = {
  primary: 'bg-brand-black text-brand-gold border border-brand-gold hover:bg-brand-gold hover:text-brand-black',
  secondary: 'bg-transparent border border-brand-black text-brand-black hover:bg-brand-black hover:text-brand-white',
  outline: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  warning: 'bg-white text-amber-700 border border-amber-400 hover:bg-amber-50',
  amber: 'bg-amber-500 text-white hover:bg-amber-600',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
}

export function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`px-4 py-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
