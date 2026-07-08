import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export const ROLE_HOME = {
  walk_in: '/walkin',
  payment: '/payment',
  releasing: '/releasing',
  admin: '/admin',
}

export function ProtectedRoute({ role, children }) {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (user?.role_name !== role) {
    return <Navigate to={ROLE_HOME[user?.role_name] ?? '/'} replace />
  }

  return children
}
