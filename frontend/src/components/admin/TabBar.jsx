const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'users', label: 'Users' },
  { id: 'customers', label: 'Customers' },
  { id: 'products', label: 'Products' },
  { id: 'history', label: 'Transaction History' },
]

export function TabBar({ active, onSelect }) {
  return (
    <nav className="flex gap-6 border-b border-gray-300">
      {TABS.map((tab) => {
        if (tab.disabled) {
          return (
            <span
              key={tab.id}
              className="px-1 py-3 text-sm font-medium text-gray-400 border-b-2 border-transparent select-none"
            >
              {tab.label}
            </span>
          )
        }

        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`px-1 py-3 text-sm border-b-2 transition-colors ${
              isActive
                ? 'font-semibold text-brand-black border-brand-gold'
                : 'font-medium text-gray-500 border-transparent hover:text-brand-black'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
