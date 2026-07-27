import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ReceiptPrintLayer } from './components/receipt/ReceiptPrintLayer'
import Login from './pages/Login'
import WalkIn from './pages/WalkIn'
import Payment from './pages/Payment'
import Releasing from './pages/Releasing'
import Admin from './pages/Admin'

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/walkin"
          element={
            <ProtectedRoute role="receiver">
              <ErrorBoundary>
                <WalkIn />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payment"
          element={
            <ProtectedRoute role="payment">
              <ErrorBoundary>
                <Payment />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/releasing"
          element={
            <ProtectedRoute role="releasing">
              <ErrorBoundary>
                <Releasing />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <ErrorBoundary>
                <Admin />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
      </Routes>
      <ReceiptPrintLayer />
    </>
  )
}

export default App
