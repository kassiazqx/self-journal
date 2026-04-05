import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthPage from './pages/AuthPage'
import MainLayout from './components/MainLayout'
import { Loader2 } from 'lucide-react'

function AppContent() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-amber-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-amber-400" />
          <p className="text-sm text-gray-400">加载中…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  return <MainLayout />
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
