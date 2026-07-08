import { Navbar } from './Navbar'
import { useWebSocket } from '../../hooks/useWebSocket'

export function PageLayout({ title, children }) {
  useWebSocket()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar title={title} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
