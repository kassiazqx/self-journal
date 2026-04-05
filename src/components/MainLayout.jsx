import { useState } from 'react'
import { Home, BookOpen, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'

const NAV_ITEMS = [
  { id: 'home',    label: '记录',  Icon: Home },
  { id: 'records', label: '列表',  Icon: BookOpen },
]

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState('home')
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0)
  const { user, signOut } = useAuth()

  // 保存成功后刷新记录列表
  const handleSaved = () => {
    setRecordsRefreshKey(k => k + 1)
  }

  return (
    <div
      className="flex flex-col max-w-lg mx-auto w-full"
      style={{ height: '100dvh' }}
    >
      {/* 顶部状态栏区域（仅在 records 显示用户信息） */}
      {activeTab === 'records' && (
        <div className="flex items-center justify-end px-5 pt-3">
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <LogOut size={14} />
            <span>退出</span>
          </button>
        </div>
      )}

      {/* 页面内容区域：flex-1 + overflow-hidden 确保内容在这里滚动，不撑开外层 */}
      <div className="flex-1 overflow-hidden min-h-0">
        {/* 首页 */}
        <div className={`h-full overflow-y-auto ${activeTab === 'home' ? 'block' : 'hidden'}`}>
          <HomePage onSaved={handleSaved} />
        </div>

        {/* 记录列表页 */}
        <div className={`h-full overflow-y-auto ${activeTab === 'records' ? 'block' : 'hidden'}`}>
          <RecordsPage refreshKey={recordsRefreshKey} />
        </div>
      </div>

      {/* 底部导航栏 */}
      <div className="bg-white border-t border-gray-100 shadow-sm safe-bottom">
        <div className="flex">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon
                size={22}
                strokeWidth={activeTab === id ? 2.2 : 1.8}
              />
              <span className={`text-xs font-medium ${activeTab === id ? 'text-amber-500' : 'text-gray-400'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
