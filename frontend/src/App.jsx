import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import Login from './pages/Login'
import WalkIn from './pages/WalkIn'
import Payment from './pages/Payment'
import Releasing from './pages/Releasing'
import Admin from './pages/Admin'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        path="/walkin"
        element={
          <ProtectedRoute role="receiver">
            <WalkIn />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payment"
        element={
          <ProtectedRoute role="payment">
            <Payment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/releasing"
        element={
          <ProtectedRoute role="releasing">
            <Releasing />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <Admin />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
