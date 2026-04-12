// src/pages/ThreadsPage.jsx
// 脉络列表页：已确认 + 待确认 + 创建入口
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchThreads, createThread, updateThread, deleteThread } from '../lib/threadService'

export default function ThreadsPage({ onBack, onOpenThread }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCandidates, setShowCandidates] = useState(false)

  useEffect(() => {
    if (!user) return
    load()
  }, [user])

  async function load() {
    setLoading(true)
    const { data } = await fetchThreads(user.id)
    setThreads(data ?? [])
    setLoading(false)
  }

  async function handleCreate() {
    if (!newName.trim()) return
    const { data } = await createThread(user.id, { name: newName.trim(), status: 'confirmed' })
    if (data) setThreads(prev => [data, ...prev])
    setNewName('')
    setCreating(false)
  }

  async function handleConfirm(thread) {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  async function handleDelete(thread) {
    await deleteThread(thread.id, user.id)
    setThreads(prev => prev.filter(t => t.id !== thread.id))
  }

  const confirmed = threads.filter(t => t.status === 'confirmed')
  const candidates = threads.filter(t => t.status === 'candidate')

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack}
            style={{ background: 'none', border: 'none', color: '#bbb',
              cursor: 'pointer', fontSize: 14 }}>
            ← 返回
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>脉络</span>
        </div>
        <button onClick={() => setCreating(true)}
          style={{ fontSize: 12, color: '#c9a96e', background: 'none',
            border: 'none', cursor: 'pointer' }}>
          + 新建
        </button>
      </div>

      {/* 新建输入框 */}
      {creating && (
        <div style={{ padding: '12px 18px', background: '#faf8f4',
          borderBottom: '1px solid #ede9e2' }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
            placeholder="脉络名称，如：内心平静探索"
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            style={{
              width: '100%', border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 12px', fontSize: 13, outline: 'none',
              background: 'white', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setCreating(false); setNewName('') }}
              style={{ fontSize: 12, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer' }}>
              取消
            </button>
            <button onClick={handleCreate}
              style={{ fontSize: 12, color: '#c9a96e', background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 500 }}>
              创建
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* 已确认脉络 */}
        {confirmed.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>已确认</div>
            {confirmed.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenThread(thread)}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                  marginBottom: 10, cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                {thread.arc_summary && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.6,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {thread.arc_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 待确认（折叠） */}
        {candidates.length > 0 && (
          <div>
            <button
              onClick={() => setShowCandidates(v => !v)}
              style={{ fontSize: 11, color: '#aaa', background: 'none', border: 'none',
                cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              待确认（{candidates.length}）{showCandidates ? '▲' : '▼'}
            </button>
            {showCandidates && candidates.map(thread => (
              <div key={thread.id}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                  marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  border: '1px dashed #e0dbd4' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500, marginBottom: 8 }}>
                  {thread.name}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => handleConfirm(thread)}
                    style={{ fontSize: 12, color: '#c9a96e', background: 'none',
                      border: '1px solid #f0e8d4', borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer' }}>
                    接受
                  </button>
                  <button onClick={() => handleDelete(thread)}
                    style={{ fontSize: 12, color: '#bbb', background: 'none',
                      border: '1px solid #e0dbd4', borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer' }}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {threads.length === 0 && !creating && (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
            暂无脉络，生成回顾信后 AI 会提议
          </div>
        )}
      </div>
    </div>
  )
}
