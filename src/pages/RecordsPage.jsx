// src/pages/RecordsPage.jsx
// 记录列表：journal_entries + review_letters 混合时间流，按日期分组
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { deleteEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { checkAndGenerateLetter } from '../lib/reviewLetterService'
import FilterBar from '../components/FilterBar'
import {
  getPendingCoreNeedsCount,
  getPendingCoreNeeds,
  deletePendingCoreNeed,
  addCoreNeed,
  loadCoreNeeds,
} from '../lib/coreNeedsService'
import { loadContacts } from '../lib/contactsService'
import { updateEntry } from '../lib/journalService'

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
function EntryCard({ entry, onOpen, onLongPress }) {
  const tpl = resolveTemplate(entry.template_type)
  const emotions = entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? [])
  const preview = (entry.content ?? '').slice(0, 60)

  const pressTimer = useRef(null)
  const didLongPress = useRef(false)  // 防止长按后 onClick 也触发

  function startPress() {
    didLongPress.current = false
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true
      onLongPress?.(entry)
    }, 600)
  }
  function cancelPress() {
    clearTimeout(pressTimer.current)
  }
  function handleClick() {
    if (didLongPress.current) { didLongPress.current = false; return }
    onOpen(entry)
  }

  return (
    <div
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      style={{
        background: 'white', borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        WebkitUserSelect: 'none', userSelect: 'none',
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
        background: '#fffdf8',
        border: '1px solid #f0e8d4',
        borderLeft: letter.is_read ? '1px solid #f0e8d4' : '3px solid #c9a96e',
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

const ENTRY_PAGE = 50   // 每次加载的条数

export default function RecordsPage({ onOpenDetail, onOpenLetter, onEdit }) {
  const { user } = useAuth()
  const [allEntries, setAllEntries] = useState([])
  const [allLetters, setAllLetters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [entryOffset, setEntryOffset] = useState(0)
  const [hasMoreEntries, setHasMoreEntries] = useState(false)
  const loadingMoreRef = useRef(false)
  const [latestUnreadLetter, setLatestUnreadLetter] = useState(null)

  // 搜索 + 筛选
  const [showSearch, setShowSearch]         = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [peopleOptions, setPeopleOptions]   = useState([])
  const [coreNeedOptions, setCoreNeedOptions] = useState([])
  const [filteredEntries, setFilteredEntries] = useState(null) // null = 无筛选，[] = 筛选结果空
  const [actionEntry, setActionEntry] = useState(null)   // 长按选中的条目
  const [confirmDelete, setConfirmDelete] = useState(false)

  // pending_core_needs banner + 处理卡片
  const [pendingCount, setPendingCount]   = useState(0)
  const [showPendingCard, setShowPendingCard] = useState(false)
  const [pendingItems, setPendingItems]   = useState([])
  const [currentPendingIdx, setCurrentPendingIdx] = useState(0)
  const [pendingEditValue, setPendingEditValue]   = useState('')
  const [showPendingEdit, setShowPendingEdit]     = useState(false)
  const [showMergeList, setShowMergeList]         = useState(false)
  const [coreNeedsVocab, setCoreNeedsVocab]       = useState([])

  // filteredEntries !== null → 筛选模式：只显示筛选出的 journal_entries，不含回顾信
  const items = filteredEntries !== null
    ? filteredEntries.map(e => ({ ...e, _type: 'entry', _sortKey: e.created_at }))
    : [
        ...allEntries.map(e => ({ ...e, _type: 'entry',  _sortKey: e.created_at })),
        ...allLetters.map(l => ({ ...l, _type: 'letter', _sortKey: l.period_end })),
      ].sort((a, b) => new Date(b._sortKey) - new Date(a._sortKey))

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
        .range(0, ENTRY_PAGE - 1),
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

    setAllEntries(entries)
    setAllLetters(letters)
    setEntryOffset(ENTRY_PAGE)
    setHasMoreEntries(entries.length === ENTRY_PAGE)

    // 查询 pending_core_needs 数量
    const count = await getPendingCoreNeedsCount()
    setPendingCount(count ?? 0)

    setLoading(false)
  }, [user])

  async function loadMoreEntries() {
    if (loadingMoreRef.current || !hasMoreEntries) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const { data } = await db.from('journal_entries')
      .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(entryOffset, entryOffset + ENTRY_PAGE - 1)
    const newEntries = data ?? []
    setAllEntries(prev => [...prev, ...newEntries])
    setEntryOffset(prev => prev + ENTRY_PAGE)
    setHasMoreEntries(newEntries.length === ENTRY_PAGE)
    loadingMoreRef.current = false
    setLoadingMore(false)
  }

  function handleScroll(e) {
    if (loadingMoreRef.current || !hasMoreEntries || loading) return
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMoreEntries()
    }
  }

  useEffect(() => { load() }, [load])

  // 加载 core_needs 词库（供「合并到已有词条」）
  useEffect(() => {
    if (!user) return
    loadCoreNeeds().then(setCoreNeedsVocab).catch(console.error)
  }, [user])

  // ── pending_core_needs 处理 ──────────────────────────────────
  async function handleOpenPendingCard() {
    const items = await getPendingCoreNeeds()
    setPendingItems(items)
    setCurrentPendingIdx(0)
    setPendingEditValue('')
    setShowPendingEdit(false)
    setShowMergeList(false)
    setShowPendingCard(true)
  }

  function advancePending(newItems) {
    if (newItems.length === 0) {
      setShowPendingCard(false)
      setPendingCount(0)
    } else {
      setPendingItems(newItems)
      setCurrentPendingIdx(0)
      setPendingEditValue('')
      setShowPendingEdit(false)
      setShowMergeList(false)
      setPendingCount(newItems.length)
    }
  }

  async function handlePendingAddToVocab(item) {
    await addCoreNeed(item.proposed)
    const srcEntry = item.journal_entries
    const current = srcEntry?.core_needs ?? []
    if (!current.includes(item.proposed)) {
      await updateEntry({
        id: item.entry_id,
        userId: srcEntry?.user_id,
        fields: { core_needs: [...current, item.proposed] },
      })
    }
    await deletePendingCoreNeed(item.id)
    advancePending(pendingItems.filter(p => p.id !== item.id))
  }

  async function handlePendingEditSave(item) {
    const newWord = pendingEditValue.trim()
    if (!newWord) return
    if (newWord.length > 20 || /["'\\n]/.test(newWord)) return
    await addCoreNeed(newWord)
    const srcEntry = item.journal_entries
    const current = srcEntry?.core_needs ?? []
    if (!current.includes(newWord)) {
      await updateEntry({
        id: item.entry_id,
        userId: srcEntry?.user_id,
        fields: { core_needs: [...current, newWord] },
      })
    }
    await deletePendingCoreNeed(item.id)
    advancePending(pendingItems.filter(p => p.id !== item.id))
  }

  async function handlePendingMerge(item, existingWord) {
    const srcEntry = item.journal_entries
    const current = srcEntry?.core_needs ?? []
    if (!current.includes(existingWord)) {
      await updateEntry({
        id: item.entry_id,
        userId: srcEntry?.user_id,
        fields: { core_needs: [...current, existingWord] },
      })
    }
    await deletePendingCoreNeed(item.id)
    advancePending(pendingItems.filter(p => p.id !== item.id))
  }

  // 加载内容类型标签（用于 FilterBar categoryOptions）
  useEffect(() => {
    if (!user) return
    db.from('user_options')
      .select('option_value')
      .eq('user_id', user.id)
      .eq('field_name', 'content_category')
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCategoryOptions((data ?? []).map(r => r.option_value)))
    loadContacts().then(list => setPeopleOptions((list ?? []).map(c => c.canonical))).catch(() => {})
    loadCoreNeeds().then(list => setCoreNeedOptions((list ?? []).map(n => n.option_value))).catch(() => {})
  }, [user?.id])

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
    setActionEntry(null)
    setConfirmDelete(false)
    load()
  }

  async function handleFilter({ searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate }) {
    const hasFilter = searchText.trim() || selectedEmotions.length ||
                      selectedCategories.length || selectedPeople.length ||
                      selectedCoreNeeds.length || selectedDate
    if (!hasFilter) {
      setFilteredEntries(null)   // 恢复默认列表（含回顾信）
      return
    }

    let query = db.from('journal_entries')
      .select('id, content, entry_summary, created_at, emotions, emotion_display, category_tags, people_involved, core_needs, template_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (searchText.trim()) {
      const escaped = searchText.replace(/%/g, '\\%').replace(/_/g, '\\_')
      query = query.or(
        `content.ilike.%${escaped}%,` +
        `entry_summary.ilike.%${escaped}%,` +
        `cognitive_analysis.ilike.%${escaped}%,` +
        `body_sensations.ilike.%${escaped}%,` +
        `reflection_insight.ilike.%${escaped}%`
      )
    }
    if (selectedEmotions.length) {
      query = query.overlaps('emotions', selectedEmotions)
    }
    if (selectedCategories.length) {
      query = query.overlaps('category_tags', selectedCategories)
    }
    if (selectedPeople.length) {
      query = query.overlaps('people_involved', selectedPeople)
    }
    if (selectedCoreNeeds.length) {
      query = query.overlaps('core_needs', selectedCoreNeeds)
    }
    if (selectedDate) {
      const y = selectedDate.getFullYear()
      const m = selectedDate.getMonth()
      const d = selectedDate.getDate()
      query = query
        .gte('created_at', new Date(y, m, d, 0, 0, 0).toISOString())
        .lte('created_at', new Date(y, m, d, 23, 59, 59).toISOString())
    }

    const { data } = await query
    setFilteredEntries(data ?? [])
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f5f3ef' }}>

      {/* 顶部 sticky 区域（header + FilterBar） */}
      <div style={{ flexShrink: 0 }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px 10px',
          background: '#faf8f4', borderBottom: '1px solid #ede9e2',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>记录</span>
          <button
            onClick={() => {
              if (showSearch) {
                setShowSearch(false)
                setFilteredEntries(null)
              } else {
                setShowSearch(true)
              }
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: '#888', lineHeight: 1, padding: '0 2px' }}
          >
            {showSearch ? '✕' : '🔍'}
          </button>
        </div>

        {/* FilterBar（仅 showSearch=true 时显示） */}
        {showSearch && (
          <FilterBar
            onFilter={handleFilter}
            categoryOptions={categoryOptions}
            peopleOptions={peopleOptions}
            coreNeedOptions={coreNeedOptions}
            placeholder="搜索记录内容、认知、洞见…"
            showDate={true}
          />
        )}

        {/* pending_core_needs 橙色 banner */}
        {pendingCount > 0 && (
          <div
            onClick={handleOpenPendingCard}
            style={{
              background: '#fff7ed',
              borderLeft: '3px solid #f97316',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: 13,
              color: '#92400e',
            }}
          >
            <span>● 有 {pendingCount} 个新的内心需求待确认</span>
            <span style={{ fontSize: 12 }}>查看 →</span>
          </div>
        )}
      </div>

      {/* 可滚动内容区 */}
      <div style={{ flex: 1, overflowY: 'auto' }} onScroll={filteredEntries === null ? handleScroll : undefined}>

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
        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc',
            fontSize: 14, padding: '60px 0' }}>
            加载中…
          </div>
        ) : groups.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc',
            fontSize: 14, padding: '60px 0' }}>
            {filteredEntries !== null ? '没有符合条件的记录' : '还没有记录，去写第一条吧'}
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
                    onLongPress={e => { setActionEntry(e); setConfirmDelete(false) }}
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

        {/* 底部加载提示 */}
        {!loading && (
          loadingMore ? (
            <div style={{ textAlign: 'center', color: '#ccc', fontSize: 12, padding: '10px 0 20px' }}>加载中…</div>
          ) : !hasMoreEntries && allEntries.length > 0 ? (
            <div style={{ textAlign: 'center', color: '#ddd', fontSize: 11, padding: '8px 0 20px' }}>已加载全部记录</div>
          ) : null
        )}
      </div>

      </div>  {/* 滚动内容区 */}

      {/* 长按动作菜单 */}
      {actionEntry && (
        <div
          onClick={() => { setActionEntry(null); setConfirmDelete(false) }}
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
            {/* 预览条目 */}
            <div style={{
              padding: '12px 20px 10px',
              fontSize: 13, color: '#888', lineHeight: 1.5,
              borderBottom: '1px solid #f0ece4',
            }}>
              {(actionEntry.content ?? '').slice(0, 50)}{actionEntry.content?.length > 50 ? '…' : ''}
            </div>

            {!confirmDelete ? (
              <>
                <button
                  onClick={() => { onEdit?.(actionEntry); setActionEntry(null) }}
                  style={{
                    width: '100%', padding: '16px 20px', background: 'none',
                    border: 'none', textAlign: 'left', fontSize: 15,
                    color: '#333', cursor: 'pointer',
                    borderBottom: '1px solid #f5f3ef',
                  }}
                >
                  编辑
                </button>
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
                  onClick={() => setActionEntry(null)}
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
                  onClick={() => handleDelete(actionEntry)}
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

      {/* pending_core_needs 处理卡片 */}
      {showPendingCard && pendingItems.length > 0 && (() => {
        const item = pendingItems[currentPendingIdx] ?? pendingItems[0]
        const srcEntry = item?.journal_entries
        const srcDate = srcEntry?.created_at
          ? new Date(srcEntry.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : ''

        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 200, display: 'flex', alignItems: 'flex-end',
          }}>
            <div style={{
              width: '100%', background: '#fff',
              borderRadius: '16px 16px 0 0', padding: 20,
              maxHeight: '80vh', overflowY: 'auto',
            }}>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
                待处理 {pendingItems.length} 条
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>来源记录</div>
              <div
                onClick={() => onOpenDetail?.(srcEntry)}
                style={{
                  background: '#f9f9f9', borderRadius: 10, padding: '10px 14px',
                  marginBottom: 16, cursor: srcEntry ? 'pointer' : 'default',
                }}
              >
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{srcDate}</span>
                  {srcEntry && <span style={{ color: '#6366f1' }}>查看 →</span>}
                </div>
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {srcEntry?.content ?? ''}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>AI 提议</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 20, paddingLeft: 4 }}>
                {item.proposed}
              </div>
              <button
                onClick={() => handlePendingAddToVocab(item)}
                style={{
                  width: '100%', padding: '13px 0', marginBottom: 10,
                  background: '#6366f1', color: '#fff', border: 'none',
                  borderRadius: 10, fontSize: 15, cursor: 'pointer',
                }}
              >
                ✓ 加入词库
              </button>
              <button
                onClick={() => { setShowPendingEdit(v => !v); setShowMergeList(false) }}
                style={{
                  width: '100%', padding: '13px 0', marginBottom: showPendingEdit ? 0 : 10,
                  background: '#f3f4f6', color: '#374151', border: 'none',
                  borderRadius: showPendingEdit ? '10px 10px 0 0' : 10,
                  fontSize: 15, cursor: 'pointer',
                }}
              >
                ✎ 改措辞后加入
              </button>
              {showPendingEdit && (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 12, marginBottom: 10 }}>
                  <input
                    value={pendingEditValue}
                    onChange={e => setPendingEditValue(e.target.value)}
                    placeholder={item.proposed}
                    autoFocus
                    style={{
                      width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                      borderRadius: 8, fontSize: 14, marginBottom: 4, boxSizing: 'border-box',
                    }}
                  />
                  {pendingEditValue && (pendingEditValue.length > 20 || /["'\\n]/.test(pendingEditValue)) && (
                    <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>词条过长或含无效字符</div>
                  )}
                  <button
                    onClick={() => handlePendingEditSave(item)}
                    disabled={!pendingEditValue.trim() || pendingEditValue.length > 20 || /["'\\n]/.test(pendingEditValue)}
                    style={{
                      padding: '8px 20px', background: '#6366f1', color: '#fff',
                      border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                      opacity: (pendingEditValue.trim() && pendingEditValue.length <= 20 && !/["'\\n]/.test(pendingEditValue)) ? 1 : 0.4,
                    }}
                  >
                    保存
                  </button>
                </div>
              )}
              <button
                onClick={() => { setShowMergeList(v => !v); setShowPendingEdit(false) }}
                style={{
                  width: '100%', padding: '13px 0',
                  background: '#f3f4f6', color: '#374151', border: 'none',
                  borderRadius: showMergeList ? '10px 10px 0 0' : 10,
                  fontSize: 15, cursor: 'pointer',
                }}
              >
                合并到已有词条 ›
              </button>
              {showMergeList && (
                <div style={{
                  background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: 'none',
                  borderRadius: '0 0 10px 10px', padding: 12,
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                }}>
                  {coreNeedsVocab.map(c => (
                    <span
                      key={c.id}
                      onClick={() => handlePendingMerge(item, c.option_value)}
                      style={{
                        padding: '5px 14px', background: '#ede8f5', color: '#7a6a9a',
                        borderRadius: 99, fontSize: 14, cursor: 'pointer',
                      }}
                    >
                      {c.option_value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
