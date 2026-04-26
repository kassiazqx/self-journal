// src/components/MainLayout.jsx
// 4 Tab 导航：写 / 记录 / 洞察 / 我的
// 导航栈（screens 数组）管理全屏覆盖页面（AwarenessFlow、RecordDetail、ReviewLetterDetail 等）
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getActiveTab, saveActiveTab } from '../lib/storage'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import InsightsPage from '../pages/InsightsPage'
import AwarenessFlow from './AwarenessFlow'
import RecordDetail from './RecordDetail'
import ReviewLetterDetail from './ReviewLetterDetail'
import ReviewLetterListPage from '../pages/ReviewLetterListPage'
import ThreadsPage from '../pages/ThreadsPage'
import ThreadDetailPage from '../pages/ThreadDetailPage'
import CandidateDetailPage from '../pages/CandidateDetailPage'
import EditEntryPage from '../pages/EditEntryPage'

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
  const [detailRefreshToken, setDetailRefreshToken] = useState(0)
  const [writeResetKey, setWriteResetKey] = useState(0)
  const [settingsResetKey, setSettingsResetKey] = useState(0)
  const [toast, setToast] = useState(null)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const toastTimerRef = useRef(null)

  function notify(msg) {
    clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }

  // 清理旧版导航栈 localStorage（一次性）
  useEffect(() => {
    localStorage.removeItem('nav_screens')
    localStorage.removeItem('active_tab')
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function updateKeyboardVisible() {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardVisible(keyboardHeight > 60)
    }

    updateKeyboardVisible()
    vv.addEventListener('resize', updateKeyboardVisible)
    return () => {
      vv.removeEventListener('resize', updateKeyboardVisible)
    }
  }, [])

  const currentScreen = screens[screens.length - 1] ?? null

  function push(screen) { setScreens(prev => [...prev, screen]) }
  function pop()        { setScreens(prev => prev.slice(0, -1)) }
  function reset()      { setScreens([]) }

  function goTab(id) {
    reset()
    setActiveTab(id)
    saveActiveTab(id)
    if (id === 'mine') setSettingsResetKey(k => k + 1)
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
    setWriteResetKey(k => k + 1)  // 重挂 HomePage，清空写作区
    goTab('records')
  }

  // ── AwarenessFlow 退出（点「上一张」退回写作页）───────────────
  function handleAwarenessExit(awarenessState) {
    const entry = screens[screens.length - 1]?.entry
    if (entry) {
      // 把 entry 和觉察进度带回，以编辑模式打开写作页
      // 用户再次点 ✓ 时走 updateEntry 而非 insertEntry，不会重复创建
      setScreens([{ type: 'editHome', entry, awarenessState }])
    } else {
      pop()
    }
  }

  // ── editHome 模式：写作页用已有 entry 打开，再次点 ✓ 继续觉察流 ──
  function handleEditHomeDone(updatedEntry) {
    const awarenessState = screens[screens.length - 1]?.awarenessState ?? null
    setRefreshKey(k => k + 1)
    setScreens([{
      type: 'awareness',
      entry: updatedEntry,
      initialFlowState: awarenessState,
    }])
  }

  // ── RecordsPage 打开详情 ────────────────────────────────────
  function handleOpenDetail(entry) {
    push({ type: 'detail', entry })
  }

  // ── RecordsPage 打开回顾信 ──────────────────────────────────
  function handleOpenLetter(letter) {
    push({ type: 'letter', letter })
  }

  // ── InsightsPage 打开回顾信列表 ─────────────────────────────
  function handleOpenLetterList(letters) {
    push({ type: 'letterList', letters: letters ?? [] })
  }

  // ── InsightsPage / ThreadsPage 打开脉络列表 ─────────────────
  function handleOpenThreads() {
    push({ type: 'threads' })
  }

  // ── InsightsPage / ThreadsPage 打开脉络详情 ─────────────────
  function handleOpenThread(thread, mode) {
    push({ type: 'threadDetail', thread, mode: mode ?? 'confirmed' })
  }

  // ── 候选脉络详情 ─────────────────────────────────────────────
  function handleOpenCandidate(thread) {
    push({ type: 'candidateDetail', thread })
  }

  // ── 编辑记录入口（RecordsPage 长按 / RecordDetail 编辑按钮）──
  function handleEditEntry(entry) {
    push({ type: 'editEntry', entry })
  }

  // ── EditEntryPage 保存完成 ───────────────────────────────────
  function handleEditSaved() {
    setDetailRefreshToken(t => t + 1) // 让 RecordDetail 重新拉取数据
    setRefreshKey(k => k + 1)         // 让 RecordsPage 刷新列表
    pop()
  }

  function handleEntriesMutated() {
    setRefreshKey(k => k + 1)
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
          onEdit={handleEditEntry}
          refreshToken={detailRefreshToken}
        />
      )
    }

    if (screen.type === 'letter') {
      return (
        <ReviewLetterDetail
          letter={screen.letter}
          onBack={pop}
          onOpenEntry={entryId => push({ type: 'detail', entry: { id: entryId } })}
          onOpenCandidateDetail={handleOpenCandidate}
          onOpenThreadDetail={thread => handleOpenThread(thread, 'view')}
        />
      )
    }

    if (screen.type === 'letterList') {
      return (
        <ReviewLetterListPage
          letters={screen.letters}
          onBack={pop}
          onOpenLetter={letter => push({ type: 'letter', letter })}
        />
      )
    }

    if (screen.type === 'threads') {
      return (
        <ThreadsPage
          onBack={pop}
          onOpenThread={(thread, mode) => push({ type: 'threadDetail', thread, mode: mode ?? 'confirmed' })}
          onOpenCandidate={handleOpenCandidate}
          defaultTab={screen.defaultTab}
        />
      )
    }

    if (screen.type === 'threadDetail') {
      return (
        <ThreadDetailPage
          thread={screen.thread}
          mode={screen.mode ?? 'confirmed'}
          onBack={pop}
          onOpenEntry={entry => push({ type: 'detail', entry })}
          onArchived={() => pop()}
          onRestored={() => pop()}
          onDeleted={() => pop()}
        />
      )
    }

    if (screen.type === 'candidateDetail') {
      return (
        <CandidateDetailPage
          thread={screen.thread}
          onBack={pop}
          onAccepted={() => pop()}
          onIgnored={() => pop()}
          onOpenEntry={entry => push({ type: 'detail', entry })}
        />
      )
    }

    if (screen.type === 'editHome') {
      return (
        <HomePage
          editEntry={screen.entry}
          onDone={handleEditHomeDone}
          onCancel={() => { reset(); goTab('records') }}
          onOpenLetter={letter => push({ type: 'letter', letter })}
          onNotify={notify}
        />
      )
    }

    if (screen.type === 'editEntry') {
      return (
        <EditEntryPage
          entry={screen.entry}
          onBack={pop}
          onDone={handleEditSaved}
        />
      )
    }

    return null
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', width: '100%', maxWidth: 480,
      margin: '0 auto', background: '#faf8f4',
      position: 'relative',
    }}>

      {/* 全局 Toast 通知（图片上传失败等异步事件触发） */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 56,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)',
          color: 'white',
          padding: '8px 18px',
          borderRadius: 20,
          fontSize: 13,
          zIndex: 999,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}

      {/* 主内容区（Tab 或全屏覆盖） */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

      {/* 所有 Tab 同时挂载，切换时只改 display，避免重复拉取数据 */}
        <div style={{ height: '100%', display: !currentScreen && activeTab === 'write' ? 'flex' : 'none', flexDirection: 'column' }}>
          <HomePage
            key={writeResetKey}
            gratitudeRefreshTrigger={refreshKey}
            onDone={handleHomeSaved}
            onOpenLetter={letter => push({ type: 'letter', letter })}
            onNotify={notify}
          />
        </div>
        <div style={{ height: '100%', display: !currentScreen && activeTab === 'records' ? 'flex' : 'none', flexDirection: 'column' }}>
          <RecordsPage
            refreshTrigger={refreshKey}
            onEntriesMutated={handleEntriesMutated}
            onOpenDetail={handleOpenDetail}
            onOpenLetter={handleOpenLetter}
            onOpenLetterList={handleOpenLetterList}
            onEdit={handleEditEntry}
          />
        </div>
        <div style={{ height: '100%', display: !currentScreen && activeTab === 'insights' ? 'flex' : 'none', flexDirection: 'column' }}>
          <InsightsPage
            onOpenLetterList={handleOpenLetterList}
            onOpenThreads={handleOpenThreads}
            onOpenThread={handleOpenThread}
            onOpenPendingThreads={() => push({ type: 'threads', defaultTab: 'pending' })}
          />
        </div>
        <div style={{ height: '100%', display: !currentScreen && activeTab === 'mine' ? 'flex' : 'none', flexDirection: 'column' }}>
          <SettingsPage key={settingsResetKey} />
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
      {!currentScreen && !keyboardVisible && (
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
