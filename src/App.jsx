import { Component } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthPage from './pages/AuthPage'
import MainLayout from './components/MainLayout'
import { Loader2 } from 'lucide-react'

// ─── 全局错误边界 ───────────────────────────────────────────────
// 捕获渲染阶段未处理的 JS 错误，防止白屏。
// 扩展点：可在 componentDidCatch 里上报到 Sentry / LogRocket 等监控服务。
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // 扩展点：接入外部错误监控（如 Sentry.captureException(error, { extra: info })）
    console.error('[ErrorBoundary] 渲染错误：', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-amber-50 p-6">
          <div className="text-center space-y-3">
            <p className="text-lg font-medium text-gray-700">出了一点问题…</p>
            <p className="text-sm text-gray-400">{this.state.error?.message}</p>
            <button
              className="mt-4 px-4 py-2 bg-amber-400 text-white rounded-lg text-sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

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
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  )
}
