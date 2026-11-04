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
import { TransactionsQueryPage } from './pages/TransactionsQueryPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { BudgetsPage } from './pages/BudgetsPage'
import { RecurringPage } from './pages/RecurringPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'

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
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/connect" element={<ConnectBankPage />} />
            <Route path="/accounts/connected" element={<ConnectedPage />} />
            {/* After the literal /accounts/* routes so "connect"/"connected" aren't read as ids. */}
            <Route path="/accounts/:id/transactions" element={<AccountTransactionsPage />} />
            <Route path="/spending/:categoryId" element={<CategoryDashboardPage />} />
            <Route path="/networth" element={<NetWorthPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/view" element={<TransactionsQueryPage />} />
            <Route path="/flow/:direction" element={<FlowDashboardPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
