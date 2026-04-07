import { useState, useEffect } from 'react'
import { Home, BookOpen, Settings, MessageCircle, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import TaggingPage from '../pages/TaggingPage'
import AIConversation from './AIConversation'
import ReflectionPage from '../pages/ReflectionPage'
import { analyzeContent } from '../lib/contentAnalysis'
import { getCardsForEntry } from '../lib/reflectionQuestions'

const NAV_ITEMS = [
  { id: 'home',     label: '记录', Icon: Home },
  { id: 'records',  label: '列表', Icon: BookOpen },
  { id: 'settings', label: '设置', Icon: Settings },
]

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState(() => {
    // 刷新后恢复上次所在的 tab（只恢复 home/records/settings 三个主 tab）
    const saved = localStorage.getItem('activeTab')
    return NAV_ITEMS.some(n => n.id === saved) ? saved : 'home'
  })
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0)

  // 流程状态：null → home | taggingEntry → TaggingPage | aiEntry → AI对话
  const [taggingEntry, setTaggingEntry] = useState(null)   // 进入情绪标注页
  const [aiEntry, setAiEntry]           = useState(null)   // 进入 AI 对话
  const [suggestEntry, setSuggestEntry] = useState(null)   // 显示"聊聊吗？"横幅
  const [reflectionEntry, setReflectionEntry] = useState(null) // 进入深度复盘页
  const [reflectionIndex, setReflectionIndex] = useState(0)    // 复盘页当前卡片索引（AI来回后恢复）
  const [reflectionAnswers, setReflectionAnswers] = useState({}) // 卡片答案快照（防止卸载丢失）

  // 编辑模式：从列表/详情触发
  const [editEntry, setEditEntry] = useState(null)         // 进入编辑流程（HomePage预填）

  const { user } = useAuth()

  // ── HomePage "下一步" 完成后 ─────────────────────────────────
  // entry 已保存到 Supabase，分析复杂度，进入 TaggingPage
  const handleNextStep = (entry) => {
    const { shouldSuggestChat } = analyzeContent(entry.content)
    // 把分析结果挂在 entry 上，TaggingPage 完成后 MainLayout 用
    setTaggingEntry({ ...entry, _shouldSuggestChat: shouldSuggestChat })
    setEditEntry(null)
    setRecordsRefreshKey(k => k + 1)
  }

  // ── TaggingPage "完成/保存" 后 ───────────────────────────────
  const handleTaggingComplete = ({ stateScore, goToReflection } = {}) => {
    if (goToReflection) {
      const entryForReflection = { ...taggingEntry }
      setTaggingEntry(null)
      setReflectionIndex(0)
      // 从 entry 已有字段初始化 answers，让编辑模式能预填
      const initAnswers = {}
      getCardsForEntry(entryForReflection).forEach(c => {
        const raw = entryForReflection[c.field]
        initAnswers[c.id] = Array.isArray(raw) ? raw.join('、') : (raw ?? '')
      })
      setReflectionAnswers(initAnswers)
      setReflectionEntry(entryForReflection)
      return
    }
    const shouldSuggest = taggingEntry?._shouldSuggestChat || (stateScore !== null && stateScore !== undefined && stateScore < 0)
    setTaggingEntry(null)
    if (shouldSuggest) {
      setSuggestEntry(taggingEntry)
    } else {
      handleSetActiveTab('records')
      setRecordsRefreshKey(k => k + 1)
    }
  }

  // ── 用户从"聊聊吗？"横幅点"聊聊" ────────────────────────────
  const handleAcceptSuggest = () => {
    const entry = suggestEntry
    setSuggestEntry(null)
    setAiEntry(entry)
  }

  const handleDeclineSuggest = () => {
    setSuggestEntry(null)
  }

  // ── AI 对话结束 ──────────────────────────────────────────────
  // 从复盘页唤起的 AI：关闭后回到复盘页（reflectionEntry 还在）
  // 从其他地方唤起的 AI：关闭后 reflectionEntry 为 null，正常回主界面
  const handleAIClose  = () => setAiEntry(null)
  const handleAISaved  = () => {
    setAiEntry(null)
    setReflectionEntry(null)   // 无论从哪里来，保存完成后清掉复盘状态
    handleSetActiveTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── 深度复盘页关闭 ───────────────────────────────────────────
  const handleReflectionClose = () => {
    setReflectionEntry(null)
    handleSetActiveTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── 从记录列表手动发起 AI 对话 ───────────────────────────────
  const handleStartAI = (entry) => setAiEntry(entry)

  // ── 从记录列表/详情发起编辑 ─────────────────────────────────
  const handleStartEdit = (entry) => {
    setEditEntry(entry)
    handleSetActiveTab('home')
  }

  // tab 切换时写入 localStorage
  const handleSetActiveTab = (id) => {
    setActiveTab(id)
    localStorage.setItem('activeTab', id)
  }
  useEffect(() => {
    if (!suggestEntry) return
    const timer = setTimeout(() => setSuggestEntry(null), 4000)
    return () => clearTimeout(timer)
  }, [suggestEntry])

  // ── 全屏覆盖：深度复盘（AI 唤起时让位给 AI）────────────────
  if (reflectionEntry && !aiEntry) {
    return (
      <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
        <ReflectionPage
          entry={reflectionEntry}
          onClose={handleReflectionClose}
          onStartAI={handleStartAI}
          initialIndex={reflectionIndex}
          onIndexChange={setReflectionIndex}
          initialAnswers={reflectionAnswers}
          onAnswersChange={setReflectionAnswers}
        />
      </div>
    )
  }

  // ── 全屏覆盖：AI 对话 ────────────────────────────────────────
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

  // ── 全屏覆盖：情绪标注页 ────────────────────────────────────
  if (taggingEntry) {
    return (
      <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
        <TaggingPage
          entry={taggingEntry}
          isEdit={Boolean(editEntry)}
          onComplete={handleTaggingComplete}
          onBack={() => {
            // 返回：回到 HomePage（编辑模式或新建）
            setTaggingEntry(null)
          }}
        />
      </div>
    )
  }

  // ── 全屏覆盖：编辑模式（HomePage 预填）──────────────────────
  if (editEntry) {
    return (
      <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
        <div className="flex-1 overflow-y-auto">
          <HomePage
            editEntry={editEntry}
            onNextStep={handleNextStep}
          />
        </div>
      </div>
    )
  }

  // ── 正常 Tab 布局 ────────────────────────────────────────────
  return (
    <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
      <div className="flex-1 overflow-hidden min-h-0">

        <div className={`h-full overflow-y-auto ${activeTab === 'home' ? 'block' : 'hidden'}`}>
          <HomePage onNextStep={handleNextStep} />
        </div>

        <div className={`h-full overflow-y-auto ${activeTab === 'records' ? 'block' : 'hidden'}`}>
          <RecordsPage
            isActive={activeTab === 'records'}
            refreshKey={recordsRefreshKey}
            onStartAI={handleStartAI}
            onEdit={handleStartEdit}
          />
        </div>

        <div className={`h-full overflow-y-auto ${activeTab === 'settings' ? 'block' : 'hidden'}`}>
          <SettingsPage />
        </div>
      </div>

      {/* "聊聊吗？"提示横幅（覆盖在底部导航上方）*/}
      {suggestEntry && (
        <div className="absolute bottom-16 left-0 right-0 max-w-lg mx-auto px-4 fade-in z-10">
          <div className="bg-white border border-amber-200 rounded-2xl px-4 py-3 shadow-md flex items-center gap-3">
            <span className="text-xl">✨</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">好像有点复杂</p>
              <p className="text-xs text-gray-400">要聊聊吗？</p>
            </div>
            <button
              onClick={handleAcceptSuggest}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-sm rounded-full active:scale-95 transition-transform"
            >
              <MessageCircle size={14} />
              聊聊
            </button>
            <button
              onClick={handleDeclineSuggest}
              className="text-gray-300 active:scale-95 transition-transform"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* 底部导航 */}
      <div className="bg-white border-t border-gray-100 shadow-sm safe-bottom">
        <div className="flex">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => handleSetActiveTab(id)}
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
