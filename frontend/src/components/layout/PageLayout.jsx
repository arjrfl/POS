import { Navbar } from './Navbar'
import { useWebSocket } from '../../hooks/useWebSocket'

export function PageLayout({ title, actions, children }) {
  useWebSocket()

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Navbar title={title} actions={actions} />
      <main className="flex-1 min-h-0 overflow-y-auto p-4">{children}</main>
    </div>
  )
}
