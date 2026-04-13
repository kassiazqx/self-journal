// src/pages/CandidateDetailPage.jsx
// 候选脉络详情页：AI 发现理由 + 关联记录（只读）+ 接受/忽略
// ⚠️ 独立文件：内容结构与 ThreadDetailPage 不同（AI理由 ≠ arc_summary）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateThread } from '../lib/threadService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function CandidateDetailPage({ thread: initialThread, onBack, onAccepted, onIgnored, onOpenEntry }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!thread?.id) return
    loadEntries()
  }, [thread?.id])

  async function loadEntries() {
    setLoading(true)
    const { data } = await db.from('thread_entries')
      .select('entry_id, added_at, journal_entries(id, entry_summary, created_at, template_type)')
      .eq('thread_id', thread.id)
      .eq('removed_by_user', false)
      .order('added_at', { ascending: true })
    setEntries((data ?? []).map(r => r.journal_entries).filter(Boolean))
    setLoading(false)
  }

  async function handleAccept() {
    if (acting) return
    setActing(true)
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setToast('✓ 已加入已确认脉络')
    setTimeout(() => {
      setToast('')
      onAccepted?.(thread)
    }, 1500)
  }

  async function handleIgnore() {
    if (acting) return
    setActing(true)
    await updateThread(thread.id, user.id, { status: 'rejected' })
    onIgnored?.(thread)
  }

  // 来源标签：优先读 trigger_source 字段，降级到创建时间
  const sourceLabel = thread.trigger_source === 'review'
    ? `回顾信触发 · ${formatDate(thread.created_at)}`
    : `手动分析 · ${formatDate(thread.created_at)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>
          ← 脉络
        </button>
        {/* 固定标题「候选脉络」 */}
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>候选脉络</span>
        {/* 橙色「待确认」角标 */}
        <span style={{ fontSize: 10, background: '#fff3e8', color: '#e07850', padding: '3px 10px', borderRadius: 10 }}>
          待确认
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* 脉络名称 + 来源标签 */}
        <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 6 }}>
            {thread.name}
          </div>
          <div style={{ fontSize: 11, color: '#bbb' }}>{sourceLabel}</div>
        </div>

        {/* AI 发现理由 */}
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500, marginBottom: 8 }}>
            🔍 AI 发现理由
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75 }}>
            {thread.arc_summary
              ? thread.arc_summary
              : <span style={{ color: '#ccc' }}>AI 尚未生成发现理由</span>
            }
          </div>
        </div>

        {/* 关联记录列表（只读） */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>加载中…</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>暂无关联记录</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id}
              onClick={() => onOpenEntry?.(entry)}
              style={{ background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>{formatDate(entry.created_at)}</div>
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {entry.entry_summary ?? '（暂无摘要）'}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部固定操作栏 */}
      <div style={{ padding: '12px 18px 28px', background: '#faf8f4', borderTop: '1px solid #ede9e2', display: 'flex', gap: 10, flexShrink: 0 }}>
        <button onClick={handleIgnore} disabled={acting}
          style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: acting ? 'default' : 'pointer' }}>
          忽略
        </button>
        <button onClick={handleAccept} disabled={acting}
          style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: acting ? '#e0d4b8' : '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: acting ? 'default' : 'pointer' }}>
          ✓ 接受这条脉络
        </button>
      </div>

      {/* 接受成功 Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: 'rgba(80,160,80,0.9)', color: 'white', padding: '10px 20px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
