import { useState } from 'react'
import { Home, BookOpen, Settings } from 'lucide-react'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import AIConversation from './AIConversation'
import AwarenessFlow from './AwarenessFlow'
import { getActiveTab, saveActiveTab } from '../lib/storage'

const NAV_ITEMS = [
  { id: 'home',     label: '写',   Icon: Home },
  { id: 'records',  label: '记录', Icon: BookOpen },
  { id: 'settings', label: '设置', Icon: Settings },
]

// ─── 导航栈工具函数 ────────────────────────────────────────────
// screens: [{ type, ...data }]
// type 枚举：'edit' | 'awareness' | 'ai'
// []（空栈）= 正常 Tab 布局
//
// 「edit」类型用于：
//   1. 从记录列表发起的编辑
//   2. 从 AwarenessFlow 退回写作页继续修改

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
  // 当前最顶层屏幕（null = 正常 Tab 布局）
  const currentScreen = screens[screens.length - 1] ?? null

  // ── tab 切换时持久化 ──────────────────────────────────────────
  const goTab = (id) => {
    setActiveTab(id)
    saveActiveTab(id)
  }

  const routeAfterSave = ({ entry, gotoAwareness, awarenessState = null }) => {
    reset(setScreens)
    setRecordsRefreshKey(k => k + 1)

    if (awarenessState) {
      push(setScreens, {
        type: 'awareness',
        entry,
        initialFlowState: awarenessState,
      })
      return
    }

    if (gotoAwareness) {
      push(setScreens, { type: 'awareness', entry })
      return
    }

    goTab('records')
  }

  // ── HomePage 「✓完成」后 ──────────────────────────────────────
  // onDone(entry, gotoAwareness)
  //   gotoAwareness=true  → 进觉察流（AwarenessFlow）
  //   gotoAwareness=false → 进入保存成功后的导航层
  const handleDone = (entry, gotoAwareness) => {
    const editScreen     = currentScreen
    const awarenessState = editScreen?.type === 'edit' ? editScreen.awarenessState : null
    routeAfterSave({ entry, gotoAwareness, awarenessState })
  }

  // ── AwarenessFlow 完成后 ──────────────────────────────────────
  const handleAwarenessComplete = () => {
    reset(setScreens)
    goTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── AwarenessFlow 中途退出 → 回写作页（带原始内容可编辑）──
  const handleAwarenessExit = (awarenessState) => {
    const entry = currentScreen?.entry
    if (entry) {
      setScreens([{ type: 'edit', entry, awarenessState }])
      goTab('home')
    } else {
      reset(setScreens)
      goTab('records')
      setRecordsRefreshKey(k => k + 1)
    }
  }

  // ── AI 对话 ──────────────────────────────────────────────────
  const handleAIClose = () => pop(setScreens)
  const handleAISaved = () => {
    reset(setScreens)
    goTab('records')
    setRecordsRefreshKey(k => k + 1)
  }

  // ── 从记录列表发起 AI 或编辑 ────────────────────────────────
  const handleStartAI  = (entry) => push(setScreens, { type: 'ai', entry })
  const handleStartEdit = (entry) => {
    reset(setScreens)
    push(setScreens, { type: 'edit', entry })
    goTab('home')
  }

  // ─── 全屏覆盖渲染 ─────────────────────────────────────────────
  const WRAPPER = 'flex flex-col max-w-lg mx-auto w-full'
  const STYLE   = { height: '100dvh' }

  if (currentScreen?.type === 'awareness') {
    const s = currentScreen
    return (
      <div className={WRAPPER} style={STYLE}>
        <AwarenessFlow
          entry={s.entry}
          onComplete={handleAwarenessComplete}
          onExit={handleAwarenessExit}
          initialFlowState={s.initialFlowState}
        />
      </div>
    )
  }

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

  if (currentScreen?.type === 'edit') {
    return (
      <div className={WRAPPER} style={STYLE}>
        <div className="flex-1 overflow-y-auto">
          <HomePage
            editEntry={currentScreen.entry}
            onDone={handleDone}
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
          <HomePage onDone={handleDone} />
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
