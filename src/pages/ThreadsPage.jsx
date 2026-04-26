// src/pages/ThreadsPage.jsx
// 脉络列表页：三 Tab（已确认 / 待确认 / 已归档）
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { fetchThreads, createThread, deleteThread, addEntryToThread, reAnalyzeThread } from '../lib/threadService'
import { resolveTemplate } from '../lib/templates'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadsPage({ onBack, onOpenThread, onOpenCandidate, defaultTab = 'confirmed' }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(defaultTab) // 'confirmed' | 'pending' | 'archived'

  // ＋ 浮窗
  const [showPlusMenu, setShowPlusMenu] = useState(false)

  // 手动创建
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [allEntries, setAllEntries] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [saving, setSaving] = useState(false)

  // AI 分析 sheet
  const [showAnalysisSheet, setShowAnalysisSheet] = useState(false)
  const [analysisRange, setAnalysisRange] = useState('half_year') // '7d'|'30d'|'half_year'|'1y'|'all'
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisToast, setAnalysisToast] = useState('')

  // 长按菜单（已确认列表）
  const [actionThread, setActionThread] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pressTimer = useRef(null)
  const didLongPress = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await fetchThreads(user.id)
    setThreads(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => { load() }, 0)
    return () => clearTimeout(timer)
  }, [user, load])

  // ── 手动创建 ──────────────────────────────────────────────────
  async function openCreating() {
    setShowPlusMenu(false)
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
    setCreating(false); setNewName(''); setSelectedIds(new Set()); setAllEntries([])
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleCreate() {
    if (!newName.trim() || saving) return
    setSaving(true)
    const { data: thread } = await createThread(user.id, { name: newName.trim(), status: 'confirmed' })
    if (thread && selectedIds.size > 0) {
      await Promise.all([...selectedIds].map(id => addEntryToThread(thread.id, id, 'user')))
    }
    if (thread) setThreads(prev => [thread, ...prev])
    setSaving(false)
    cancelCreating()
    setActiveTab('confirmed')
  }

  // ── AI 分析 ───────────────────────────────────────────────────
  function openAnalysisSheet() {
    setShowPlusMenu(false)
    setShowAnalysisSheet(true)
  }

  async function startAnalysis() {
    setShowAnalysisSheet(false)
    setAnalyzing(true)
    const confirmed = threads.filter(t => t.status === 'confirmed')
    let totalNew = 0
    for (const thread of confirmed) {
      const { newCount } = await reAnalyzeThread(thread.id, user.id)
      totalNew += (newCount ?? 0)
    }
    await load()
    setAnalyzing(false)
    if (totalNew > 0) {
      setAnalysisToast(`发现 ${totalNew} 个脉络候选，已加入待确认`)
    } else {
      setAnalysisToast('暂时没有发现新脉络，稍后再试')
    }
    setTimeout(() => setAnalysisToast(''), 4000)
  }

  async function handleDelete(thread) {
    await deleteThread(thread.id, user.id)
    setThreads(prev => prev.filter(t => t.id !== thread.id))
    setActionThread(null); setConfirmDelete(false)
  }

  // ── 长按菜单 ──────────────────────────────────────────────────
  function startPress(thread) {
    didLongPress.current = false
    pressTimer.current = setTimeout(() => { didLongPress.current = true; setActionThread(thread); setConfirmDelete(false) }, 600)
  }
  function cancelPress() { clearTimeout(pressTimer.current) }
  function handleThreadClick(thread) {
    if (didLongPress.current) { didLongPress.current = false; return }
    onOpenThread(thread)
  }

  // ── 分类 ──────────────────────────────────────────────────────
  const confirmed = threads.filter(t => t.status === 'confirmed')
  const candidates = threads.filter(t => t.status === 'candidate')
  const rejected = threads.filter(t => t.status === 'rejected')
  const archived = threads.filter(t => t.status === 'archived')
  const pendingBadge = candidates.length // 只计 candidate，不计 rejected

  const RANGES = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: 'half_year', label: '半年' },
    { key: '1y', label: '1年' },
    { key: 'all', label: '全部' },
  ]

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  // ── 手动创建面板（全屏覆盖）──────────────────────────────────
  if (creating) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#faf8f4' }}>
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #ede9e2' }}>
        <button onClick={cancelCreating} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>← 取消</button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>新建脉络</span>
        <button onClick={handleCreate} disabled={!newName.trim() || selectedIds.size === 0 || saving}
          style={{ fontSize: 13, fontWeight: 500, background: 'none', border: 'none', cursor: newName.trim() && selectedIds.size > 0 && !saving ? 'pointer' : 'default', color: newName.trim() && selectedIds.size > 0 && !saving ? '#c9a96e' : '#ccc' }}>
          {saving ? '创建中…' : '创建'}
        </button>
      </div>
      <div style={{ padding: '14px 18px 8px' }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="脉络名称，如：内心平静探索"
          style={{ width: '100%', border: '1px solid #e0dbd4', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none', background: 'white', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </div>
      <div style={{ padding: '0 18px 4px', fontSize: 11, color: '#aaa' }}>至少选择 1 条记录才能创建</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        {loadingEntries ? <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>加载中…</div>
          : allEntries.map(entry => {
            const selected = selectedIds.has(entry.id)
            const tpl = resolveTemplate(entry.template_type)
            const preview = entry.entry_summary || (entry.content ?? '').slice(0, 50)
            return (
              <div key={entry.id} onClick={() => toggleSelect(entry.id)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: selected ? '#fffdf8' : 'white', border: selected ? '1px solid #f0e8d4' : '1px solid transparent', borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2, border: selected ? '2px solid #c9a96e' : '2px solid #ddd', background: selected ? '#c9a96e' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selected && <span style={{ color: 'white', fontSize: 10, lineHeight: 1 }}>✓</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>{tpl.label}</span>
                    <span style={{ fontSize: 10, color: '#ccc' }}>{formatDate(entry.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview}</div>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none',
          color: '#bbb', cursor: 'pointer',
          fontSize: 20, fontWeight: 300,
          padding: '6px 8px', margin: '-6px -8px',
          lineHeight: 1,
        }}>‹</button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>脉络</span>
        {/* ＋ 按钮 */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPlusMenu(v => !v)}
            style={{ fontSize: 20, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>＋</button>
          {showPlusMenu && (
            <>
              <div onClick={() => setShowPlusMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
              <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 154, overflow: 'hidden' }}>
                <button onClick={openCreating} style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: '#333', cursor: 'pointer', borderBottom: '1px solid #f5f3ef' }}>
                  ✏️ 手动创建
                </button>
                <button onClick={openAnalysisSheet} style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: '#333', cursor: 'pointer' }}>
                  🔍 AI 分析发现
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        {[
          { key: 'confirmed', label: '已确认' },
          { key: 'pending', label: '待确认', badge: pendingBadge },
          { key: 'archived', label: '已归档' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: activeTab === tab.key ? '#c9a96e' : '#aaa', fontWeight: activeTab === tab.key ? 600 : 400, borderBottom: activeTab === tab.key ? '2px solid #c9a96e' : '2px solid transparent', position: 'relative' }}>
            {tab.label}
            {tab.badge > 0 && (
              <span style={{ position: 'absolute', top: 6, right: '20%', background: '#e07850', color: 'white', borderRadius: 10, fontSize: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* ── 已确认 Tab ── */}
        {activeTab === 'confirmed' && (
          <>
            {confirmed.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无已确认脉络
              </div>
            )}
            {confirmed.map(thread => (
              <div key={thread.id}
                onClick={() => handleThreadClick(thread)}
                onMouseDown={() => startPress(thread)} onMouseUp={cancelPress} onMouseLeave={cancelPress}
                onTouchStart={() => startPress(thread)} onTouchEnd={cancelPress} onTouchMove={cancelPress}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', WebkitUserSelect: 'none', userSelect: 'none' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                {thread.arc_summary && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {thread.arc_summary}
                  </div>
                )}
              </div>
            ))}
            {/* 底部虚线 AI 分析按钮 */}
            <button onClick={openAnalysisSheet} disabled={analyzing}
              style={{ display: 'block', width: '100%', marginTop: 8, padding: '12px', border: '1.5px dashed #e0dbd4', borderRadius: 12, background: 'none', cursor: 'pointer', fontSize: 13, color: analyzing ? '#ccc' : '#bbb', textAlign: 'center' }}>
              {analyzing ? '🔍 正在分析…' : '🔍 AI 分析发现新脉络'}
            </button>
          </>
        )}

        {/* ── 待确认 Tab ── */}
        {activeTab === 'pending' && (
          <>
            {candidates.length === 0 && rejected.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无待确认脉络
              </div>
            )}
            {/* 活跃候选 */}
            {candidates.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenCandidate?.(thread)}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px dashed #e0dbd4' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                  <span style={{ fontSize: 10, background: '#fff3e8', color: '#e07850', padding: '2px 8px', borderRadius: 10 }}>待确认</span>
                </div>
                {thread.created_at && (
                  <div style={{ fontSize: 11, color: '#ccc', marginTop: 4 }}>
                    {thread.trigger_source === 'review' ? '回顾信触发 · ' : '手动分析 · '}{formatDate(thread.created_at)}
                  </div>
                )}
              </div>
            ))}
            {/* 已忽略分隔线 */}
            {rejected.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px' }}>
                  <div style={{ flex: 1, height: 1, background: '#ede9e2' }} />
                  <span style={{ fontSize: 11, color: '#ccc' }}>已忽略</span>
                  <div style={{ flex: 1, height: 1, background: '#ede9e2' }} />
                </div>
                {rejected.map(thread => (
                  <div key={thread.id}
                    style={{ background: 'white', borderRadius: 12, padding: '10px 14px', marginBottom: 8, opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, color: '#888' }}>{thread.name}</div>
                    <button onClick={() => handleDelete(thread)}
                      style={{ fontSize: 12, color: '#e05252', background: 'none', border: '1px solid #fdd', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                      删除
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── 已归档 Tab ── */}
        {activeTab === 'archived' && (
          <>
            {archived.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无已归档脉络
              </div>
            )}
            {archived.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenThread(thread, 'archived')}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', opacity: 0.7, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 14, color: '#555', fontWeight: 500 }}>{thread.name}</div>
                {thread.updated_at && (
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>归档于 {formatDate(thread.updated_at)}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* AI 分析确认 sheet */}
      {showAnalysisSheet && (
        <div onClick={() => setShowAnalysisSheet(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 18px 32px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 6 }}>AI 分析脉络</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>选择分析范围，AI 会在这段时间的记录里寻找规律</div>
            <div style={{ background: '#fff8f0', border: '1px solid #f0e4d0', borderRadius: 10, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#c9a96e', lineHeight: 1.7 }}>
              ⏱ 通常需要 10~20 秒，分析期间可继续使用 App<br />
              📋 结果以候选形式出现，需逐一查看后确认
            </div>
            {/* 时间范围 chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 2 }}>
              {RANGES.map(r => (
                <button key={r.key} onClick={() => setAnalysisRange(r.key)}
                  style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: analysisRange === r.key ? '1.5px solid #c9a96e' : '1.5px solid #e0dbd4', background: analysisRange === r.key ? '#fff8f0' : 'white', color: analysisRange === r.key ? '#c9a96e' : '#888', fontSize: 13, cursor: 'pointer' }}>
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowAnalysisSheet(false)}
                style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={startAnalysis}
                style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                开始分析
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {analysisToast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {analysisToast}
          {analysisToast.includes('候选') && (
            <button onClick={() => { setAnalysisToast(''); setActiveTab('pending') }}
              style={{ marginLeft: 10, color: '#f0d090', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
              去查看 ›
            </button>
          )}
        </div>
      )}

      {/* 长按动作菜单 */}
      {actionThread && (
        <div onClick={() => { setActionThread(null); setConfirmDelete(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '8px 0 env(safe-area-inset-bottom)' }}>
            <div style={{ padding: '12px 20px 10px', fontSize: 13, color: '#888', borderBottom: '1px solid #f0ece4' }}>
              {actionThread.name}
            </div>
            {!confirmDelete ? (
              <>
                <button onClick={() => setConfirmDelete(true)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#e05252', cursor: 'pointer', borderBottom: '1px solid #f5f3ef' }}>
                  删除
                </button>
                <button onClick={() => setActionThread(null)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#bbb', cursor: 'pointer' }}>
                  取消
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: '14px 20px', fontSize: 13, color: '#888' }}>删除后无法恢复，确认吗？</div>
                <button onClick={() => handleDelete(actionThread)}
                  style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#e05252', cursor: 'pointer', fontWeight: 500, borderBottom: '1px solid #f5f3ef' }}>
                  确认删除
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#bbb', cursor: 'pointer' }}>
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
