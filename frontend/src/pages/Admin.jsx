import { useState } from 'react'
import { PageLayout } from '../components/layout/PageLayout'
import { Sidebar } from '../components/admin/Sidebar'
import { DashboardSection } from '../components/admin/DashboardSection'
import { TransactionsSection } from '../components/admin/TransactionsSection'
import { CustomersSection } from '../components/admin/CustomersSection'
import { ProductsSection } from '../components/admin/ProductsSection'
import { QueueMonitorSection } from '../components/admin/QueueMonitorSection'

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  customers: 'Customers',
  products: 'Products',
  queue: 'Queue Monitor',
}

const SECTIONS = {
  dashboard: DashboardSection,
  transactions: TransactionsSection,
  customers: CustomersSection,
  products: ProductsSection,
  queue: QueueMonitorSection,
}

export default function Admin() {
  const [active, setActive] = useState('dashboard')
  const ActiveSection = SECTIONS[active]

  return (
    <PageLayout title={`Admin — ${SECTION_TITLES[active]}`}>
      <div className="flex gap-6">
        <Sidebar active={active} onSelect={setActive} />
        <div className="flex-1 min-w-0">
          <ActiveSection />
        </div>
      </div>
    </PageLayout>
  )
}
