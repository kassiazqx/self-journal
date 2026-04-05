import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { BookOpen, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react'

export default function AuthPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'success'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successEmail, setSuccessEmail] = useState('')

  const { signIn, signUp } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!email || !password) {
      setError('请填写邮箱和密码')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            setError('邮箱或密码不正确，请重试')
          } else if (error.message.includes('Email not confirmed')) {
            setError('请先验证邮箱，查收注册时发送的确认邮件')
          } else {
            setError(error.message)
          }
        }
      } else {
        const { error } = await signUp(email, password)
        if (error) {
          if (error.message.includes('already registered')) {
            setError('该邮箱已注册，请直接登录')
          } else {
            setError(error.message)
          }
        } else {
          setSuccessEmail(email)
          setMode('success')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // 注册成功提示页
  if (mode === 'success') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-amber-50 to-orange-50">
        <div className="w-full max-w-sm text-center fade-in">
          <div className="text-6xl mb-6">✉️</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">确认邮件已发送</h2>
          <p className="text-gray-500 mb-2 leading-relaxed">
            请前往 <span className="font-medium text-amber-600">{successEmail}</span> 收取确认邮件
          </p>
          <p className="text-gray-400 text-sm mb-8">点击邮件中的链接即可完成注册</p>
          <button
            onClick={() => setMode('login')}
            className="btn-primary w-full text-base"
          >
            去登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* 顶部 Logo 区域 */}
      <div className="flex flex-col items-center pt-20 pb-10 px-6">
        <div className="w-20 h-20 bg-amber-500 rounded-3xl flex items-center justify-center shadow-lg mb-5">
          <BookOpen size={40} color="white" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">自我觉察日记</h1>
        <p className="text-gray-400 text-sm">记录当下，读懂自己</p>
      </div>

      {/* 登录/注册表单 */}
      <div className="flex-1 px-6 max-w-sm mx-auto w-full">
        {/* Tab 切换 */}
        <div className="flex bg-white rounded-2xl p-1 mb-6 shadow-sm border border-orange-100">
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              mode === 'login'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-500'
            }`}
            onClick={() => { setMode('login'); setError('') }}
          >
            登录
          </button>
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              mode === 'signup'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-500'
            }`}
            onClick={() => { setMode('signup'); setError('') }}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 邮箱输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">邮箱</label>
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-300 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                autoComplete="email"
                inputMode="email"
              />
            </div>
          </div>

          {/* 密码输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">密码</label>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? '至少 6 位' : '请输入密码'}
                className="w-full pl-11 pr-12 py-3.5 bg-white border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-300 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-500 text-sm px-4 py-3 rounded-2xl fade-in">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full text-base py-4 mt-2 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>{mode === 'login' ? '登录中...' : '注册中...'}</span>
              </>
            ) : (
              <span>{mode === 'login' ? '登录' : '创建账号'}</span>
            )}
          </button>
        </form>

        {/* 底部说明 */}
        <p className="text-center text-xs text-gray-300 mt-8 px-4 leading-relaxed">
          你的数据安全存储在 Supabase，只有你自己可以访问
        </p>
      </div>
    </div>
  )
}
