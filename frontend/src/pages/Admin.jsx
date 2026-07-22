import { useState } from 'react'
import { PageLayout } from '../components/layout/PageLayout'
import { TabBar } from '../components/admin/TabBar'
import { DashboardSection } from '../components/admin/DashboardSection'
import { TransactionsSection } from '../components/admin/TransactionsSection'
import { CustomersSection } from '../components/admin/CustomersSection'
import { ProductsSection } from '../components/admin/ProductsSection'
import { useAdminLiveSync } from '../hooks/useAdminLiveSync'

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  transactions: 'Transaction History',
  customers: 'Customers',
  products: 'Products',
}

const SECTIONS = {
  dashboard: DashboardSection,
  transactions: TransactionsSection,
  customers: CustomersSection,
  products: ProductsSection,
}

export default function Admin() {
  const [active, setActive] = useState('dashboard')
  const ActiveSection = SECTIONS[active]

  // Kept at page level (not inside a tab section) so live invalidation keeps
  // working no matter which tab is currently active — see useAdminLiveSync.js.
  useAdminLiveSync()

  return (
    <PageLayout title={`Admin — ${SECTION_TITLES[active]}`}>
      <div className="flex flex-col gap-4 h-full">
        <TabBar active={active} onSelect={setActive} />
        <div className="flex-1 min-h-0">
          <ActiveSection />
        </div>
      </div>
    </PageLayout>
  )
}
