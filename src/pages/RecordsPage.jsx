import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Loader2, BookOpen, Pencil, Trash2 } from 'lucide-react'
import RecordDetail from '../components/RecordDetail'

const TEMPLATE_MAP = {
  gratitude: { emoji: '🩷', label: '感恩',  color: 'bg-pink-50 text-pink-600 border-pink-100' },
  learning:  { emoji: '📝', label: '学习',  color: 'bg-blue-50 text-blue-600 border-blue-100' },
  emotion:   { emoji: '🌷', label: '觉察',  color: 'bg-purple-50 text-purple-600 border-purple-100' },
  action:    { emoji: '💪🏻', label: '行动', color: 'bg-green-50 text-green-600 border-green-100' },
  free:      { emoji: '✨', label: '灵感',  color: 'bg-gray-50 text-gray-500 border-gray-100' },
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay === 1) return '昨天'
  if (diffDay < 7) return `${diffDay} 天前`

  return date.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
  })
}

function groupByDate(entries) {
  const groups = {}
  entries.forEach(entry => {
    const date = new Date(entry.created_at)
    const key = date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    })
    if (!groups[key]) groups[key] = []
    groups[key].push(entry)
  })
  return groups
}

// 删除确认弹窗
function DeleteDialog({ entry, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-white rounded-t-3xl p-6 pb-8 fade-in safe-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h3 className="text-lg font-semibold text-gray-800 mb-2">删除这条记录？</h3>
        <p className="text-sm text-gray-400 mb-6 leading-relaxed line-clamp-3">
          {entry.content}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 bg-gray-100 text-gray-600 rounded-2xl font-medium"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3.5 bg-red-500 text-white rounded-2xl font-medium"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

// 单条记录卡片（支持长按触发操作菜单）
function EntryCard({ entry, onOpen, onAction }) {
  const template = TEMPLATE_MAP[entry.template_type] || TEMPLATE_MAP.free
  const hasAI = entry.primary_emotion || entry.reflection_insight || entry.mixed_emotions?.length > 0
  const longPressTimer = useRef(null)
  const didLongPress = useRef(false)

  const startLongPress = () => {
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      onAction(entry)
    }, 500)
  }

  const cancelLongPress = () => {
    clearTimeout(longPressTimer.current)
  }

  const handleClick = () => {
    if (didLongPress.current) return  // 长按触发了，忽略 click
    onOpen(entry)
  }

  return (
    <div
      className="card mb-3 fade-in cursor-pointer active:scale-[0.99] transition-transform select-none"
      onClick={handleClick}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
    >
      {/* 顶部：模板标签 + 时间 */}
      <div className="flex items-center justify-between mb-2.5">
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${template.color}`}>
          {template.emoji} {template.label}
        </span>
        <span className="text-xs text-gray-300">{formatDate(entry.created_at)}</span>
      </div>

      {/* 内容预览（固定 3 行） */}
      <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap line-clamp-3">
        {entry.content}
      </p>

      {/* 情绪/AI 标记 */}
      {hasAI && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {entry.primary_emotion && (
            <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
              {entry.primary_emotion}
            </span>
          )}
          {entry.mixed_emotions?.slice(0, 2).map(e => (
            <span key={e} className="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full border border-gray-100">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RecordsPage({ refreshKey, onStartAI, onEdit }) {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [detailEntry, setDetailEntry] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionTarget, setActionTarget] = useState(null)  // 长按操作菜单目标
  const PAGE_SIZE = 20

  const fetchEntries = useCallback(async (reset = false) => {
    if (!user) return

    const isReset = reset
    if (isReset) setLoading(true)
    else setLoadingMore(true)

    try {
      const from = isReset ? 0 : entries.length
      const { data, error } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error

      setHasMore(data.length === PAGE_SIZE)
      setEntries(prev => isReset ? data : [...prev, ...data])
    } catch (err) {
      console.error('加载记录失败:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [user, entries.length])

  // 初始加载 & refreshKey 变化时重新加载
  useEffect(() => {
    fetchEntries(true)
  }, [user, refreshKey]) // eslint-disable-line

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await supabase
        .from('journal_entries')
        .delete()
        .eq('id', deleteTarget.id)
        .eq('user_id', user.id)

      setEntries(prev => prev.filter(e => e.id !== deleteTarget.id))
    } catch (err) {
      console.error('删除失败:', err)
    } finally {
      setDeleteTarget(null)
    }
  }

  const grouped = groupByDate(entries)

  // 详情页覆盖
  if (detailEntry) {
    return (
      <RecordDetail
        entry={detailEntry}
        onBack={() => setDetailEntry(null)}
        onStartAI={onStartAI}
        onEdit={onEdit ? (e) => { setDetailEntry(null); onEdit(e) } : undefined}
        onDelete={(e) => { setDetailEntry(null); setDeleteTarget(e) }}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题 */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">我的记录</h1>
        <span className="text-sm text-gray-400">{entries.length} 条</span>
      </div>

      {/* 记录列表 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center pt-20">
            <Loader2 size={28} className="animate-spin text-amber-400" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 fade-in">
            <BookOpen size={56} className="text-gray-200 mb-4" strokeWidth={1} />
            <p className="text-gray-400 font-medium mb-1">还没有记录</p>
            <p className="text-gray-300 text-sm">去首页写下今天的第一条记录吧</p>
          </div>
        ) : (
          <>
            {Object.entries(grouped).map(([dateLabel, dayEntries]) => (
              <div key={dateLabel} className="mb-2">
                {/* 日期分组标题 */}
                <div className="flex items-center gap-2 mb-3 sticky top-0 py-2 bg-[#fdfaf7]">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium px-1">{dateLabel}</span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                {/* 当天记录 */}
                {dayEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    onOpen={setDetailEntry}
                    onAction={setActionTarget}
                  />
                ))}
              </div>
            ))}

            {/* 加载更多 */}
            {hasMore && (
              <button
                onClick={() => fetchEntries(false)}
                disabled={loadingMore}
                className="w-full py-3 text-sm text-amber-500 flex items-center justify-center gap-2"
              >
                {loadingMore
                  ? <><Loader2 size={14} className="animate-spin" /> 加载中…</>
                  : '加载更多'
                }
              </button>
            )}

            {!hasMore && entries.length > PAGE_SIZE && (
              <p className="text-center text-xs text-gray-300 py-4">已经到底啦～</p>
            )}
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DeleteDialog
          entry={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 长按操作菜单 */}
      {actionTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setActionTarget(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-white rounded-t-3xl pb-8 fade-in safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mt-4 mb-2" />
            <p className="text-xs text-gray-300 text-center mb-2 px-6 line-clamp-1">{actionTarget.content}</p>
            {onEdit && (
              <button
                onClick={() => { setActionTarget(null); onEdit(actionTarget) }}
                className="w-full flex items-center gap-3 px-6 py-4 text-gray-700 active:bg-gray-50"
              >
                <Pencil size={18} className="text-gray-400" />
                <span className="text-base">编辑</span>
              </button>
            )}
            <button
              onClick={() => { setActionTarget(null); setDeleteTarget(actionTarget) }}
              className="w-full flex items-center gap-3 px-6 py-4 text-red-500 active:bg-red-50"
            >
              <Trash2 size={18} />
              <span className="text-base">删除</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
