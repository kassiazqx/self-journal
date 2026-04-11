// src/pages/RecordsPage.jsx
// 记录列表：journal_entries + review_letters 混合时间流，按日期分组
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { deleteEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { checkAndGenerateLetter } from '../lib/reviewLetterService'

// 把 ISO 字符串格式化成「4月9日 周三」
function formatGroupDate(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

// 把 ISO 字符串格式化成「09:41」
function formatTime(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// 单条记录卡片
function EntryCard({ entry, onOpen }) {
  const tpl = resolveTemplate(entry.template_type)
  const emotions = entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? [])
  const preview = (entry.content ?? '').slice(0, 60)

  return (
    <div
      onClick={() => onOpen(entry)}
      style={{
        background: 'white', borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>
          {tpl.label}
        </span>
        <span style={{ fontSize: 10, color: '#ccc' }}>{formatTime(entry.created_at)}</span>
      </div>
      <div style={{
        fontSize: 13, color: '#555', lineHeight: 1.6,
        marginBottom: emotions.length ? 8 : 0,
        display: '-webkit-box', WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {preview}
      </div>
      {emotions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {emotions.slice(0, 3).map(w => (
            <span key={w} style={{
              fontSize: 10, background: '#f0ece4', color: '#8a7a6a',
              padding: '2px 7px', borderRadius: 10,
            }}>{w}</span>
          ))}
          {emotions.length > 3 && (
            <span style={{ fontSize: 10, color: '#bbb' }}>…</span>
          )}
        </div>
      )}
    </div>
  )
}

// 回顾信卡片
function LetterCard({ letter, onOpen }) {
  const start = new Date(letter.period_start).toLocaleDateString('zh-CN',
    { month: 'long', day: 'numeric' })
  const end = new Date(letter.period_end).toLocaleDateString('zh-CN',
    { month: 'long', day: 'numeric' })
  const preview = (letter.content ?? '').slice(0, 50)

  return (
    <div
      onClick={() => onOpen(letter)}
      style={{
        background: '#fffdf8', border: '1px solid #f0e8d4',
        borderRadius: 12, padding: '12px 14px', marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>✉</span>
        <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>回顾信</span>
        {!letter.is_read && (
          <span style={{ width: 6, height: 6, borderRadius: '50%',
            background: '#c9a96e', display: 'inline-block' }} />
        )}
      </div>
      <div style={{
        fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 4,
        display: '-webkit-box', WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {preview}
      </div>
      <div style={{ fontSize: 10, color: '#bbb' }}>
        {start} - {end} · {letter.entry_ids?.length ?? 0} 条记录
      </div>
    </div>
  )
}

export default function RecordsPage({ onOpenDetail, onOpenLetter }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [latestUnreadLetter, setLatestUnreadLetter] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)

    // 触发回顾信检查（异步，不阻塞列表加载）
    checkAndGenerateLetter(user.id).catch(() => {})

    const [entriesRes, lettersRes] = await Promise.all([
      db.from('journal_entries')
        .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      db.from('review_letters')
        .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
        .eq('user_id', user.id)
        .order('period_end', { ascending: false })
        .limit(20),
    ])

    const entries = entriesRes.data ?? []
    const letters = lettersRes.data ?? []

    // 找最新未读回顾信
    const unread = letters.find(l => !l.is_read)
    setLatestUnreadLetter(unread ?? null)

    // 合并，按时间降序
    const combined = [
      ...entries.map(e => ({ ...e, _type: 'entry',  _sortKey: e.created_at })),
      ...letters.map(l => ({ ...l, _type: 'letter', _sortKey: l.period_end })),
    ].sort((a, b) => new Date(b._sortKey) - new Date(a._sortKey))

    setItems(combined)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // 按日期分组
  const groups = []
  let currentDate = ''
  items.forEach(item => {
    const dateKey = formatGroupDate(item._sortKey)
    if (dateKey !== currentDate) {
      currentDate = dateKey
      groups.push({ date: dateKey, items: [] })
    }
    groups[groups.length - 1].items.push(item)
  })

  async function handleDelete(entry) {
    await deleteEntry({ id: entry.id, userId: user.id })
    load()
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
        加载中…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f5f3ef' }}>

      {/* 未读回顾信横幅 */}
      {latestUnreadLetter && (
        <div
          onClick={() => onOpenLetter(latestUnreadLetter)}
          style={{
            background: '#fffdf8', borderBottom: '1px solid #f0e8d4',
            padding: '12px 18px', display: 'flex', alignItems: 'center',
            gap: 8, cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 14 }}>✉</span>
          <span style={{ flex: 1, fontSize: 13, color: '#8a7a5a' }}>
            你有一封新的回顾信
          </span>
          <span style={{ fontSize: 12, color: '#c9a96e' }}>查看 →</span>
        </div>
      )}

      {/* 按日期分组的时间流 */}
      <div style={{ padding: '12px 16px' }}>
        {groups.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc',
            fontSize: 14, padding: '60px 0' }}>
            还没有记录，去写第一条吧
          </div>
        ) : (
          groups.map(group => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8,
                letterSpacing: '0.5px' }}>
                {group.date}
              </div>
              {group.items.map(item => (
                item._type === 'entry' ? (
                  <EntryCard
                    key={item.id}
                    entry={item}
                    onOpen={onOpenDetail}
                    onDelete={handleDelete}
                  />
                ) : (
                  <LetterCard
                    key={item.id}
                    letter={item}
                    onOpen={onOpenLetter}
                  />
                )
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
