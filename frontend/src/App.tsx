import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from './pages/LoginPage'
import { VerifyPage } from './pages/VerifyPage'
import { DashboardPage } from './pages/DashboardPage'
import { AccountsPage } from './pages/AccountsPage'
import { ConnectBankPage } from './pages/ConnectBankPage'
import { ConnectedPage } from './pages/ConnectedPage'
import { AccountTransactionsPage } from './pages/AccountTransactionsPage'
import { CategoryDashboardPage } from './pages/CategoryDashboardPage'
import { FlowDashboardPage } from './pages/FlowDashboardPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { ProtectedRoute } from './components/ProtectedRoute'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/verify" element={<VerifyPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/accounts" element={<ProtectedRoute><AccountsPage /></ProtectedRoute>} />
          <Route path="/accounts/connect" element={<ProtectedRoute><ConnectBankPage /></ProtectedRoute>} />
          <Route path="/accounts/connected" element={<ProtectedRoute><ConnectedPage /></ProtectedRoute>} />
          {/* After the literal /accounts/* routes so "connect"/"connected" aren't read as ids. */}
          <Route path="/accounts/:id/transactions" element={<ProtectedRoute><AccountTransactionsPage /></ProtectedRoute>} />
          <Route path="/spending/:categoryId" element={<ProtectedRoute><CategoryDashboardPage /></ProtectedRoute>} />
          <Route path="/flow/:direction" element={<ProtectedRoute><FlowDashboardPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
