// src/pages/ThreadsPage.jsx
// 脉络列表页：已确认 + 待确认 + 创建入口（含记录勾选）
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { fetchThreads, createThread, updateThread, deleteThread, addEntryToThread } from '../lib/threadService'
import { resolveTemplate } from '../lib/templates'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadsPage({ onBack, onOpenThread }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCandidates, setShowCandidates] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  // 新建时的记录选择
  const [allEntries, setAllEntries] = useState([])       // 所有可选记录
  const [selectedIds, setSelectedIds] = useState(new Set()) // 已勾选的 id
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [saving, setSaving] = useState(false)

  // 长按动作菜单
  const [actionThread, setActionThread] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pressTimer = useRef(null)
  const didLongPress = useRef(false)

  function startPress(thread) {
    didLongPress.current = false
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true
      setActionThread(thread)
      setConfirmDelete(false)
    }, 600)
  }
  function cancelPress() { clearTimeout(pressTimer.current) }
  function handleThreadClick(thread) {
    if (didLongPress.current) { didLongPress.current = false; return }
    onOpenThread(thread)
  }

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

  // 打开新建面板，同时加载所有记录
  async function openCreating() {
    setCreating(true)
    setNewName('')
    setSelectedIds(new Set())
    setLoadingEntries(true)
    const { data } = await db.from('journal_entries')
      .select('id, content, entry_summary, created_at, template_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setAllEntries(data ?? [])
    setLoadingEntries(false)
  }

  function cancelCreating() {
    setCreating(false)
    setNewName('')
    setSelectedIds(new Set())
    setAllEntries([])
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleCreate() {
    if (!newName.trim() || saving) return
    setSaving(true)

    // 1. 创建脉络
    const { data: thread } = await createThread(user.id, {
      name: newName.trim(),
      status: 'confirmed',
    })

    // 2. 批量关联已选记录
    if (thread && selectedIds.size > 0) {
      await Promise.all(
        [...selectedIds].map(entryId => addEntryToThread(thread.id, entryId, 'user'))
      )
    }

    if (thread) setThreads(prev => [thread, ...prev])
    setSaving(false)
    cancelCreating()
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
          <button onClick={creating ? cancelCreating : onBack}
            style={{ background: 'none', border: 'none', color: '#bbb',
              cursor: 'pointer', fontSize: 14 }}>
            ← {creating ? '取消' : '返回'}
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>
            {creating ? '新建脉络' : '脉络'}
          </span>
        </div>
        {!creating && (
          <button onClick={openCreating}
            style={{ fontSize: 12, color: '#c9a96e', background: 'none',
              border: 'none', cursor: 'pointer' }}>
            + 新建
          </button>
        )}
        {creating && (
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || selectedIds.size === 0 || saving}
            style={{
              fontSize: 13, fontWeight: 500, background: 'none', border: 'none',
              cursor: newName.trim() && selectedIds.size > 0 && !saving ? 'pointer' : 'default',
              color: newName.trim() && selectedIds.size > 0 && !saving ? '#c9a96e' : '#ccc',
            }}>
            {saving ? '创建中…' : '创建'}
          </button>
        )}
      </div>

      {/* ── 新建面板 ── */}
      {creating && (
        <div style={{ flex: 1, overflowY: 'auto', background: '#faf8f4' }}>

          {/* 名称输入框 */}
          <div style={{ padding: '16px 18px 12px' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
              placeholder="脉络名称，如：内心平静探索"
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreate() }}
              style={{
                width: '100%', border: '1px solid #e0dbd4', borderRadius: 8,
                padding: '10px 12px', fontSize: 14, outline: 'none',
                background: 'white', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 记录列表 */}
          <div style={{ padding: '0 18px 4px' }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
              至少选择 1 条记录才能创建
            </div>

            {loadingEntries ? (
              <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                加载中…
              </div>
            ) : allEntries.length === 0 ? (
              <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                暂无记录
              </div>
            ) : (
              allEntries.map(entry => {
                const selected = selectedIds.has(entry.id)
                const tpl = resolveTemplate(entry.template_type)
                const preview = entry.entry_summary
                  || (entry.content ?? '').slice(0, 50)

                return (
                  <div
                    key={entry.id}
                    onClick={() => toggleSelect(entry.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      background: selected ? '#fffdf8' : 'white',
                      border: selected ? '1px solid #f0e8d4' : '1px solid transparent',
                      borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                      cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* 勾选圆圈 */}
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      marginTop: 2,
                      border: selected ? '2px solid #c9a96e' : '2px solid #ddd',
                      background: selected ? '#c9a96e' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && (
                        <span style={{ color: 'white', fontSize: 10, lineHeight: 1 }}>✓</span>
                      )}
                    </div>

                    {/* 内容 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>
                          {tpl.label}
                        </span>
                        <span style={{ fontSize: 10, color: '#ccc' }}>
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 12, color: '#555', lineHeight: 1.6,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {preview}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* 底部已选计数 */}
          {selectedIds.size > 0 && (
            <div style={{
              position: 'sticky', bottom: 0,
              padding: '10px 18px',
              background: 'linear-gradient(transparent, #faf8f4 40%)',
              fontSize: 12, color: '#c9a96e', textAlign: 'center',
            }}>
              已选 {selectedIds.size} 条记录
            </div>
          )}
        </div>
      )}

      {/* ── 脉络列表 ── */}
      {!creating && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* 已确认脉络 */}
          {confirmed.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>已确认</div>
              {confirmed.map(thread => (
                <div key={thread.id}
                  onClick={() => handleThreadClick(thread)}
                  onMouseDown={() => startPress(thread)}
                  onMouseUp={cancelPress}
                  onMouseLeave={cancelPress}
                  onTouchStart={() => startPress(thread)}
                  onTouchEnd={cancelPress}
                  onTouchMove={cancelPress}
                  style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                    marginBottom: 10, cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    WebkitUserSelect: 'none', userSelect: 'none' }}>
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

          {threads.length === 0 && (
            <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
              暂无脉络，生成回顾信后 AI 会提议
            </div>
          )}

          {/* 归档脉络入口（占位，归档切换逻辑后续实现） */}
          {threads.some(t => t.status === 'archived') && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{ fontSize: 12, color: '#bbb', background: 'none', border: 'none',
                  cursor: 'pointer', display: 'block', margin: '0 auto' }}>
                {showArchived ? '收起已归档' : '查看已归档'} {showArchived ? '▲' : '▼'}
              </button>
              {showArchived && threads.filter(t => t.status === 'archived').map(thread => (
                <div key={thread.id}
                  style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                    marginTop: 8, opacity: 0.5,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 长按动作菜单（已确认脉络） */}
      {actionThread && (
        <div
          onClick={() => { setActionThread(null); setConfirmDelete(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', background: 'white',
              borderRadius: '16px 16px 0 0',
              padding: '8px 0 env(safe-area-inset-bottom)',
            }}
          >
            {/* 脉络名称预览 */}
            <div style={{
              padding: '12px 20px 10px',
              fontSize: 13, color: '#888', lineHeight: 1.5,
              borderBottom: '1px solid #f0ece4',
            }}>
              {actionThread.name}
            </div>

            {!confirmDelete ? (
              <>
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{
                    width: '100%', padding: '16px 20px', background: 'none',
                    border: 'none', textAlign: 'left', fontSize: 15,
                    color: '#e05252', cursor: 'pointer',
                    borderBottom: '1px solid #f5f3ef',
                  }}
                >
                  删除
                </button>
                <button
                  onClick={() => setActionThread(null)}
                  style={{
                    width: '100%', padding: '16px 20px', background: 'none',
                    border: 'none', textAlign: 'left', fontSize: 15,
                    color: '#bbb', cursor: 'pointer',
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: '14px 20px', fontSize: 13, color: '#888' }}>
                  删除后无法恢复，确认吗？
                </div>
                <button
                  onClick={() => { handleDelete(actionThread); setActionThread(null); setConfirmDelete(false) }}
                  style={{
                    width: '100%', padding: '14px 20px', background: 'none',
                    border: 'none', textAlign: 'left', fontSize: 15,
                    color: '#e05252', cursor: 'pointer', fontWeight: 500,
                    borderBottom: '1px solid #f5f3ef',
                  }}
                >
                  确认删除
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    width: '100%', padding: '14px 20px', background: 'none',
                    border: 'none', textAlign: 'left', fontSize: 15,
                    color: '#bbb', cursor: 'pointer',
                  }}
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
