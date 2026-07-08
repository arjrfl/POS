export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${className}`} {...props}>
      {children}
    </div>
  )
}
