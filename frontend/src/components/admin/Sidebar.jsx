const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'customers', label: 'Customers' },
  { id: 'products', label: 'Products' },
  { id: 'queue', label: 'Queue Monitor' },
]

export function Sidebar({ active, onSelect }) {
  return (
    <nav className="w-48 shrink-0 flex flex-col gap-1">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onSelect(section.id)}
          className={`text-left px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            active === section.id ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          {section.label}
        </button>
      ))}
    </nav>
  )
}
