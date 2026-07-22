import { useSearchParams } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'
import { TabBar } from '../components/admin/TabBar'
import { DashboardSection } from '../components/admin/DashboardSection'
import { TransactionsSection } from '../components/admin/TransactionsSection'
import { CustomersSection } from '../components/admin/CustomersSection'
import { ProductsSection } from '../components/admin/ProductsSection'
import { useAdminLiveSync } from '../hooks/useAdminLiveSync'

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  history: 'Transaction History',
  customers: 'Customers',
  products: 'Products',
}

const SECTIONS = {
  dashboard: DashboardSection,
  history: TransactionsSection,
  customers: CustomersSection,
  products: ProductsSection,
}

const VALID_TABS = ['dashboard', 'customers', 'products', 'history']

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('view')
  const active = VALID_TABS.includes(requested) ? requested : 'dashboard'
  const ActiveSection = SECTIONS[active]

  const handleSelect = (tab) => {
    setSearchParams({ view: tab }, { replace: true })
  }

  // Kept at page level (not inside a tab section) so live invalidation keeps
  // working no matter which tab is currently active — see useAdminLiveSync.js.
  useAdminLiveSync()

  return (
    <PageLayout title={`Admin — ${SECTION_TITLES[active]}`}>
      <div className="flex flex-col gap-4 h-full">
        <TabBar active={active} onSelect={handleSelect} />
        <div className="flex-1 min-h-0">
          <ActiveSection />
        </div>
      </div>
    </PageLayout>
  )
}
