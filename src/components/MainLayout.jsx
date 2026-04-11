// src/components/MainLayout.jsx
// 4 Tab 导航：写 / 记录 / 洞察 / 我的
// 导航栈（screens 数组）管理全屏覆盖页面（AwarenessFlow、RecordDetail、ReviewLetterDetail）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getActiveTab, saveActiveTab } from '../lib/storage'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import InsightsPage from '../pages/InsightsPage'
import AwarenessFlow from './AwarenessFlow'
import RecordDetail from './RecordDetail'
import ReviewLetterDetail from './ReviewLetterDetail'

const NAV_ITEMS = [
  { id: 'write',    label: '写',   icon: null },
  { id: 'records',  label: '记录', icon: null },
  { id: 'insights', label: '洞察', icon: null },
  { id: 'mine',     label: '我的', icon: null },
]

export default function MainLayout() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(() => {
    const saved = getActiveTab()
    return NAV_ITEMS.some(n => n.id === saved) ? saved : 'write'
  })
  const [screens, setScreens] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)

  // 清理旧版导航栈 localStorage（一次性）
  useEffect(() => {
    localStorage.removeItem('nav_screens')
    localStorage.removeItem('active_tab')
  }, [])

  const currentScreen = screens[screens.length - 1] ?? null

  function push(screen) { setScreens(prev => [...prev, screen]) }
  function pop()        { setScreens(prev => prev.slice(0, -1)) }
  function reset()      { setScreens([]) }

  function goTab(id) {
    reset()
    setActiveTab(id)
    saveActiveTab(id)
  }

  // ── HomePage 完成写作后 ─────────────────────────────────────
  function handleHomeSaved(entry, gotoAwareness) {
    setRefreshKey(k => k + 1)
    if (gotoAwareness) {
      push({ type: 'awareness', entry })
    } else {
      goTab('records')
    }
  }

  // ── AwarenessFlow 完成后 ────────────────────────────────────
  function handleAwarenessComplete() {
    setRefreshKey(k => k + 1)
    goTab('records')
  }

  // ── AwarenessFlow 退出 ──────────────────────────────────────
  function handleAwarenessExit(awarenessState) {
    // 如果带 awarenessState（从 RecordDetail 进去的），直接 pop 回详情
    // 否则回到写作页
    pop()
  }

  // ── RecordsPage 打开详情 ────────────────────────────────────
  function handleOpenDetail(entry) {
    push({ type: 'detail', entry })
  }

  // ── RecordsPage 打开回顾信 ──────────────────────────────────
  function handleOpenLetter(letter) {
    push({ type: 'letter', letter })
  }

  // ── RecordDetail 打开 AwarenessFlow ────────────────────────
  function handleOpenAwarenessFromDetail(entry) {
    push({ type: 'awareness', entry })
  }

  // ── 渲染当前全屏覆盖页（screens 栈顶） ───────────────────────
  function renderScreen(screen) {
    if (!screen) return null

    if (screen.type === 'awareness') {
      return (
        <AwarenessFlow
          entry={screen.entry}
          onComplete={handleAwarenessComplete}
          onExit={handleAwarenessExit}
          initialFlowState={screen.initialFlowState ?? null}
        />
      )
    }

    if (screen.type === 'detail') {
      return (
        <RecordDetail
          entry={screen.entry}
          onBack={pop}
          onOpenAwareness={handleOpenAwarenessFromDetail}
        />
      )
    }

    if (screen.type === 'letter') {
      return (
        <ReviewLetterDetail
          letter={screen.letter}
          onBack={pop}
          onOpenEntry={entryId => push({ type: 'detail', entry: { id: entryId } })}
        />
      )
    }

    return null
  }

  // ── Tab 内容 ────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {
      case 'write':
        return <HomePage onDone={handleHomeSaved} />
      case 'records':
        return (
          <RecordsPage
            key={refreshKey}
            onOpenDetail={handleOpenDetail}
            onOpenLetter={handleOpenLetter}
          />
        )
      case 'insights':
        return <InsightsPage />
      case 'mine':
        return <SettingsPage />
      default:
        return null
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', width: '100%', maxWidth: 480,
      margin: '0 auto', background: '#faf8f4',
      position: 'relative',
    }}>

      {/* 主内容区（Tab 或全屏覆盖） */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Tab 内容（全屏覆盖时仍在 DOM，避免状态丢失） */}
        <div style={{
          height: '100%',
          display: currentScreen ? 'none' : 'flex',
          flexDirection: 'column',
        }}>
          {renderTab()}
        </div>

        {/* 全屏覆盖页 */}
        {currentScreen && (
          <div style={{
            position: 'absolute', inset: 0,
            background: '#faf8f4',
            display: 'flex', flexDirection: 'column',
          }}>
            {renderScreen(currentScreen)}
          </div>
        )}
      </div>

      {/* 底部导航（全屏覆盖时隐藏） */}
      {!currentScreen && (
        <nav style={{
          display: 'flex',
          borderTop: '1px solid #ede9e2',
          background: '#faf8f4',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => goTab(item.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '10px 0', background: 'none', border: 'none',
                cursor: 'pointer', gap: 3, minWidth: 0,
              }}
            >
              {item.icon && <span style={{ fontSize: 18 }}>{item.icon}</span>}
              <span style={{
                fontSize: 10, letterSpacing: '0.5px',
                color: activeTab === item.id ? '#2d2928' : '#ccc',
                fontWeight: activeTab === item.id ? 600 : 400,
              }}>
                {item.label}
              </span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
