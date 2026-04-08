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
import { getActiveTab, saveActiveTab } from '../lib/storage'

const NAV_ITEMS = [
  { id: 'home',     label: '记录', Icon: Home },
  { id: 'records',  label: '列表', Icon: BookOpen },
  { id: 'settings', label: '设置', Icon: Settings },
]

// ─── 导航栈工具函数 ────────────────────────────────────────────
// screens: [{ type, ...data }]
// type 枚举：'edit' | 'tagging' | 'reflection' | 'ai'
// []（空栈）= 正常 Tab 布局
//
// 「edit」类型同时服务两种场景：
//   1. 从记录列表发起的编辑（editEntry 已在 DB，isEdit = true）
//   2. 新建流程从 TaggingPage 回退（entry 刚插入 DB，isEdit = false → 回退后变 true）
//      B 方案：回退时把 tagging.entry 包成 { type:'edit', entry } 推入栈，
//              所有字段自动保留；以后新增字段不需要改这里。

function push(setScreens, screen) {
  setScreens(prev => [...prev, screen])
}
function pop(setScreens) {
  setScreens(prev => prev.slice(0, -1))
}
function reset(setScreens) {
  setScreens([])
}

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = getActiveTab()
    return NAV_ITEMS.some(n => n.id === saved) ? saved : 'home'
  })
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0)
  const [screens, setScreens] = useState([])       // 导航栈
  const [suggestEntry, setSuggestEntry] = useState(null)  // 横幅（非全屏，单独存）

  const { user } = useAuth()

  // 当前最顶层屏幕（null = 正常 Tab 布局）
  const currentScreen = screens[screens.length - 1] ?? null

  // ── tab 切换时持久化 ──────────────────────────────────────────
  const goTab = (id) => {
    setActiveTab(id)
    saveActiveTab(id)
  }

  // ── HomePage 「下一步」完成后 ─────────────────────────────────
  const handleNextStep = (entry) => {
    const { shouldSuggestChat } = analyzeContent(entry.content)
    const isEdit = Boolean(screens.find(s => s.type === 'edit'))
    reset(setScreens)
    push(setScreens, {
      type: 'tagging',
      entry: { ...entry, _shouldSuggestChat: shouldSuggestChat },
      isEdit,
    })
    setRecordsRefreshKey(k => k + 1)
  }

  // ── TaggingPage 完成后 ────────────────────────────────────────
  const handleTaggingComplete = ({ stateScore, goToReflection } = {}) => {
    const taggingScreen = currentScreen  // type === 'tagging'
    const entry = taggingScreen?.entry

    if (goToReflection) {
      const initAnswers = {}
      getCardsForEntry(entry).forEach(c => {
        const raw = entry[c.field]
        initAnswers[c.id] = Array.isArray(raw) ? raw.join('、') : (raw ?? '')
      })
      // replace tagging → reflection
      setScreens([{ type: 'reflection', entry, index: 0, answers: initAnswers }])
      return
    }

    const shouldSuggest = entry?._shouldSuggestChat ||
      (stateScore !== null && stateScore !== undefined && stateScore < 0)
    reset(setScreens)
    if (shouldSuggest) {
      setSuggestEntry(entry)
    } else {
      goTab('records')
      setRecordsRefreshKey(k => k + 1)
    }
  }

  // ── 建议横幅 ─────────────────────────────────────────────────
  const handleAcceptSuggest = () => {
    const entry = suggestEntry
    setSuggestEntry(null)
    push(setScreens, { type: 'ai', entry })
  }

  // ── AI 对话 ──────────────────────────────────────────────────
  const handleAIClose = () => pop(setScreens)
  const handleAISaved = () => {
    reset(setScreens)
    goTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── 深度复盘 ─────────────────────────────────────────────────
  const handleReflectionClose = () => {
    reset(setScreens)
    goTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── 从记录列表/详情发起 AI 或编辑 ────────────────────────────
  const handleStartAI  = (entry) => push(setScreens, { type: 'ai', entry })
  const handleStartEdit = (entry) => {
    reset(setScreens)
    push(setScreens, { type: 'edit', entry })
    goTab('home')
  }

  // 横幅自动消失
  useEffect(() => {
    if (!suggestEntry) return
    const timer = setTimeout(() => setSuggestEntry(null), 4000)
    return () => clearTimeout(timer)
  }, [suggestEntry])

  // ─── 全屏覆盖渲染 ─────────────────────────────────────────────
  const WRAPPER = 'flex flex-col max-w-lg mx-auto w-full'
  const STYLE   = { height: '100dvh' }

  if (currentScreen?.type === 'ai') {
    return (
      <div className={WRAPPER} style={STYLE}>
        <AIConversation
          entry={currentScreen.entry}
          onClose={handleAIClose}
          onSaved={handleAISaved}
        />
      </div>
    )
  }

  if (currentScreen?.type === 'reflection') {
    const s = currentScreen
    return (
      <div className={WRAPPER} style={STYLE}>
        <ReflectionPage
          entry={s.entry}
          onClose={handleReflectionClose}
          onBack={() => setScreens([{ type: 'tagging', entry: s.entry, isEdit: false }])}
          onStartAI={(entry) => push(setScreens, { type: 'ai', entry })}
          initialIndex={s.index}
          onIndexChange={(i) =>
            setScreens(prev => prev.map((sc, idx) =>
              idx === prev.length - 1 ? { ...sc, index: i } : sc
            ))
          }
          initialAnswers={s.answers}
          onAnswersChange={(a) =>
            setScreens(prev => prev.map((sc, idx) =>
              idx === prev.length - 1 ? { ...sc, answers: a } : sc
            ))
          }
        />
      </div>
    )
  }

  if (currentScreen?.type === 'tagging') {
    const s = currentScreen
    return (
      <div className={WRAPPER} style={STYLE}>
        <TaggingPage
          entry={s.entry}
          isEdit={s.isEdit}
          onComplete={handleTaggingComplete}
          onBack={() => {
            if (s.isEdit) {
              // 编辑旧记录：回到 edit 屏（pop 还原）
              pop(setScreens)
            } else {
              // 新建流程：entry 已入库，切换成 edit 模式保留所有字段（B 方案）
              // 以后加任何新字段，这里都不需要改
              setScreens([{ type: 'edit', entry: s.entry }])
            }
          }}
        />
      </div>
    )
  }

  if (currentScreen?.type === 'edit') {
    return (
      <div className={WRAPPER} style={STYLE}>
        <div className="flex-1 overflow-y-auto">
          <HomePage
            editEntry={currentScreen.entry}
            onNextStep={handleNextStep}
            onCancel={() => { reset(setScreens); goTab('records') }}
          />
        </div>
      </div>
    )
  }

  // ─── 正常 Tab 布局 ────────────────────────────────────────────
  return (
    <div className={`${WRAPPER} relative`} style={STYLE}>
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

      {/* 「聊聊吗？」提示横幅 */}
      {suggestEntry && (
        <div className="absolute bottom-16 left-0 right-0 max-w-lg mx-auto px-4 fade-in z-10">
          <div className="bg-white border border-primary-200 rounded-2xl px-4 py-3 shadow-md flex items-center gap-3">
            <span className="text-xl">✨</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">好像有点复杂</p>
              <p className="text-xs text-gray-400">要聊聊吗？</p>
            </div>
            <button
              onClick={handleAcceptSuggest}
              className="flex items-center gap-1 px-3 py-1.5 bg-primary-500 text-white text-sm rounded-full active:scale-95 transition-transform"
            >
              <MessageCircle size={14} />
              聊聊
            </button>
            <button
              onClick={() => setSuggestEntry(null)}
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
              onClick={() => goTab(id)}
            >
              <Icon size={22} strokeWidth={activeTab === id ? 2.2 : 1.8} />
              <span className={`text-xs font-medium ${activeTab === id ? 'text-primary-500' : 'text-gray-400'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
