import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { ROLE_HOME } from '../components/ProtectedRoute'
import { post } from '../services/api'

export function useAuth() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const storeLogin = useAuthStore((state) => state.login)
  const storeLogout = useAuthStore((state) => state.logout)

  const login = async (username, password) => {
    try {
      const data = await post('/auth/login', { username, password })
      const userData = {
        id: data.user_id,
        username: data.username,
        full_name: data.full_name,
        role_name: data.role_name,
      }
      storeLogin(userData, data.access_token)
      navigate(ROLE_HOME[data.role_name] ?? '/', { replace: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const logout = () => {
    storeLogout()
    navigate('/', { replace: true })
  }

  return { user, token, isAuthenticated, login, logout }
}
