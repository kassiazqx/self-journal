// src/pages/ThreadDetailPage.jsx
// 脉络详情页：arc_summary + 关联记录列表 + 刷新轨迹
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchThreadWithEntries,
  updateThread,
  refreshArcSummary,
} from '../lib/threadService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadDetailPage({ thread: initialThread, onBack, onOpenEntry }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(initialThread?.name ?? '')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!thread?.id) return
    load()
  }, [thread?.id])

  async function load() {
    setLoading(true)
    const { thread: t, entries: e } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setEntries(e ?? [])
    setLoading(false)
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === thread.name) {
      setEditingName(false)
      setNameInput(thread.name)
      return
    }
    await updateThread(thread.id, user.id, { name: trimmed })
    setThread(prev => ({ ...prev, name: trimmed }))
    setEditingName(false)
  }

  async function handleRefreshArc() {
    if (refreshing) return
    setRefreshing(true)
    await refreshArcSummary(thread.id, user.id)
    // 重新拉取最新 arc_summary
    const { thread: t } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setRefreshing(false)
  }

  // 把 thread_entries 里的 journal_entries 展开，按时间排列
  const entryList = entries
    .map(e => e.journal_entries)
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14 }}>
          ← 返回
        </button>

        {/* 可编辑标题 */}
        {editingName ? (
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            autoFocus
            onBlur={handleSaveName}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveName() }}
            style={{
              fontSize: 15, fontWeight: 600, color: '#333',
              border: 'none', borderBottom: '1px solid #c9a96e',
              outline: 'none', background: 'transparent',
              textAlign: 'center', width: 160, fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            onClick={() => { setEditingName(true); setNameInput(thread.name) }}
            style={{ fontSize: 15, fontWeight: 600, color: '#333', cursor: 'pointer' }}>
            {thread?.name}
          </span>
        )}

        {/* 刷新轨迹按钮 */}
        <button
          onClick={handleRefreshArc}
          disabled={refreshing || entryList.length < 2}
          style={{
            fontSize: 11, color: refreshing ? '#ccc' : '#c9a96e',
            background: 'none', border: 'none', cursor: 'pointer',
          }}>
          {refreshing ? '生成中…' : '↻ 刷新'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* arc_summary */}
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4',
          borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 6, fontWeight: 500 }}>
            变化轨迹
          </div>
          {thread?.arc_summary ? (
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75 }}>
              {thread.arc_summary}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65 }}>
              {entryList.length < 2
                ? '关联 2 条以上记录后可生成变化轨迹'
                : '点击右上角「↻ 刷新」生成变化轨迹'}
            </div>
          )}
          {thread?.arc_updated_at && (
            <div style={{ fontSize: 10, color: '#ccc', marginTop: 8, textAlign: 'right' }}>
              更新于 {formatDate(thread.arc_updated_at)}
            </div>
          )}
        </div>

        {/* 关联记录列表 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entryList.length}）
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 20 }}>
            加载中…
          </div>
        ) : entryList.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 20 }}>
            暂无关联记录，AI 生成回顾信时会自动关联
          </div>
        ) : (
          entryList.map(entry => (
            <div key={entry.id}
              onClick={() => onOpenEntry?.(entry)}
              style={{
                background: 'white', borderRadius: 12, padding: '12px 14px',
                marginBottom: 10, cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 6 }}>
                {formatDate(entry.created_at)}
              </div>
              <div style={{
                fontSize: 13, color: '#333', lineHeight: 1.65,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {entry.entry_summary ?? '（暂无摘要）'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
