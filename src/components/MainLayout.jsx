import { useState } from 'react'
import { Home, BookOpen, Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import AIConversation from './AIConversation'

const NAV_ITEMS = [
  { id: 'home',     label: '记录', Icon: Home },
  { id: 'records',  label: '列表', Icon: BookOpen },
  { id: 'settings', label: '设置', Icon: Settings },
]

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState('home')
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0)
  const [aiEntry, setAiEntry] = useState(null)
  const { user } = useAuth()

  const handleSaved = (entry) => {
    setRecordsRefreshKey(k => k + 1)
    if (entry) setAiEntry(entry)
  }

  const handleAIClose = () => setAiEntry(null)

  const handleAISaved = () => {
    setAiEntry(null)
    setActiveTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // 从记录列表手动发起 AI 对话（复用 setAiEntry）
  const handleStartAI = (entry) => {
    setAiEntry(entry)
  }

  // AI 对话全屏覆盖
  if (aiEntry) {
    return (
      <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
        <AIConversation
          entry={aiEntry}
          onClose={handleAIClose}
          onSaved={handleAISaved}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
      <div className="flex-1 overflow-hidden min-h-0">
        <div className={`h-full overflow-y-auto ${activeTab === 'home' ? 'block' : 'hidden'}`}>
          <HomePage onSaved={handleSaved} />
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'records' ? 'block' : 'hidden'}`}>
          <RecordsPage refreshKey={recordsRefreshKey} onStartAI={handleStartAI} />
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'settings' ? 'block' : 'hidden'}`}>
          <SettingsPage />
        </div>
      </div>

      <div className="bg-white border-t border-gray-100 shadow-sm safe-bottom">
        <div className="flex">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={22} strokeWidth={activeTab === id ? 2.2 : 1.8} />
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
