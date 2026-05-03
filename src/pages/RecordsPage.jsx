// src/pages/RecordsPage.jsx
// 记录列表：journal_entries + review_letters 混合时间流，按日期分组
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { getImageUrl, deleteImage } from '../lib/imageStorage'
import { deleteEntry, deleteEntries, listEntries, primeEntries, updateEntry } from '../lib/entryRepository'
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
import { JOURNAL_ENTRY_FULL_SELECT } from '../lib/entrySnapshots'
import { useEntryList } from '../hooks/useEntry'

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
function EntryCard({ entry, onOpen, onLongPress, isSelecting, isSelected, onToggle }) {
  const tpl = resolveTemplate(entry.template_type)
  const emotions = [...new Set(entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? []))]
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
    if (isSelecting) { onToggle?.(entry.id); return }
    onOpen(entry.id)
  }

  const imageUrls = entry.image_urls ?? []
  const hasThumbnail = imageUrls.length > 0

  return (
    <div
      data-testid={`record-entry-card-${entry.id}`}
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      style={{
        background: isSelected ? '#fffbf0' : 'white',
        borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        WebkitUserSelect: 'none', userSelect: 'none',
        display: 'flex', gap: 10, alignItems: 'flex-start',
        outline: isSelected ? '2px solid #c9a96e' : 'none',
        outlineOffset: -2,
      }}
    >
      {/* 多选 checkbox */}
      {isSelecting && (
        <div style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          alignSelf: 'center',
          background: isSelected ? '#c9a96e' : 'none',
          border: isSelected ? 'none' : '1.5px solid #ddd',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isSelected && (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
      {/* 左侧文字区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>
            {tpl.label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {hasThumbnail && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#bbb' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                {imageUrls.length}
              </span>
            )}
            <span style={{ fontSize: 10, color: '#ccc' }}>{formatTime(entry.created_at)}</span>
          </div>
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

      {/* 右侧缩略图 */}
      {hasThumbnail && (
        <img
          src={getImageUrl(imageUrls[0])}
          alt=""
          style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
        />
      )}
    </div>
  )
}

const ENTRY_PAGE = 50   // 每次加载的条数

export default function RecordsPage({ refreshTrigger, onOpenDetail, onOpenLetterList, onEdit, onEntriesMutated }) {
  const { user } = useAuth()
  // ── 多选模式 ────────────────────────────────────────────────
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
  const [allEntries, setAllEntries] = useState([])
  const [allLetters, setAllLetters] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)  // 增量刷新态：旧数据保留，顶部小指示器
  const [loadingMore, setLoadingMore] = useState(false)
  const [entryOffset, setEntryOffset] = useState(0)
  const [hasMoreEntries, setHasMoreEntries] = useState(false)
  const loadingMoreRef = useRef(false)
  const [initialUploadFailed] = useState(() => {
    try {
      const failed = JSON.parse(localStorage.getItem('image_upload_failed') ?? '[]')
      return {
        banner: failed.length > 0,
        count: failed.length,
      }
    } catch {
      // localStorage 操作容错，失败不影响主流程
      return { banner: false, count: 0 }
    }
  })
  const [uploadFailedBanner, setUploadFailedBanner] = useState(() => initialUploadFailed.banner)

  // 搜索 + 筛选
  const [showSearch, setShowSearch]         = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [peopleOptions, setPeopleOptions]   = useState([])
  const [coreNeedOptions, setCoreNeedOptions] = useState([])
  const [filteredEntries, setFilteredEntries] = useState(null) // null = 无筛选，[] = 筛选结果空
  const [actionEntry, setActionEntry] = useState(null)   // 长按选中的条目
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploadFailedCount] = useState(() => initialUploadFailed.count)

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
  const visibleSourceEntries = filteredEntries !== null ? filteredEntries : allEntries
  const storedVisibleEntries = useEntryList(visibleSourceEntries.map(entry => entry.id))
  const visibleEntries = visibleSourceEntries.map((sourceEntry) => (
    storedVisibleEntries.find(entry => entry.id === sourceEntry.id) ?? sourceEntry
  ))

  const items = visibleEntries.map(entry => ({ ...entry, _type: 'entry', _sortKey: entry.created_at }))

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)

    // 后台异步检查是否需要生成回顾信，不阻塞列表加载
    // tradeoff：如果恰好触发生成，新信需要下次刷新才能出现（低频事件，可接受）
    checkAndGenerateLetter(user.id).catch(() => {})

    const [entriesRes, lettersRes] = await Promise.all([
      listEntries({ userId: user.id, from: 0, limit: ENTRY_PAGE }),
      db.from('review_letters')
        .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
        .eq('user_id', user.id)
        .order('period_end', { ascending: false })
        .limit(20),
    ])

    const entries = entriesRes.data ?? []
    const letters = lettersRes.data ?? []

    setAllEntries(entries)
    setAllLetters(letters)
    setEntryOffset(ENTRY_PAGE)
    setHasMoreEntries(entries.length === ENTRY_PAGE)

    // 查询 pending_core_needs 数量
    const count = await getPendingCoreNeedsCount()
    setPendingCount(count ?? 0)

    setLoading(false)
  }, [user])

  // 增量刷新：保留旧数据，后台拉新数据后 merge，不出现整页 loading
  const refresh = useCallback(async () => {
    if (!user) return
    setRefreshing(true)

    checkAndGenerateLetter(user.id).catch(() => {})

    const [entriesRes, lettersRes] = await Promise.all([
      listEntries({ userId: user.id, from: 0, limit: ENTRY_PAGE }),
      db.from('review_letters')
        .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
        .eq('user_id', user.id)
        .order('period_end', { ascending: false })
        .limit(20),
    ])

    const entries = entriesRes.data ?? []
    const letters = lettersRes.data ?? []

    setAllEntries(entries)
    setAllLetters(letters)
    setEntryOffset(ENTRY_PAGE)
    setHasMoreEntries(entries.length === ENTRY_PAGE)

    const count = await getPendingCoreNeedsCount()
    setPendingCount(count ?? 0)

    setRefreshing(false)
  }, [user])

  async function loadMoreEntries() {
    if (loadingMoreRef.current || !hasMoreEntries) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const { data } = await listEntries({ userId: user.id, from: entryOffset, limit: ENTRY_PAGE })
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

  useEffect(() => {
    const timer = setTimeout(() => { load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  // refreshTrigger 变化时做增量刷新（保留旧数据，不出现整页 loading）
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (refreshTrigger <= 0) return
    const timer = setTimeout(() => { refresh() }, 0)
    return () => clearTimeout(timer)
  }, [refreshTrigger, refresh])

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
  }, [user])

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
    const paths = (entry.image_urls ?? []).filter(Boolean)
    await deleteEntry({ id: entry.id, userId: user.id })
    if (paths.length > 0) {
      await Promise.all(paths.map(p => deleteImage(p)))
    }
    setAllEntries(prev => prev.filter(item => item.id !== entry.id))
    setFilteredEntries(prev => prev === null ? prev : prev.filter(item => item.id !== entry.id))
    setActionEntry(null)
    setConfirmDelete(false)
    if (onEntriesMutated) onEntriesMutated()
    else load()
  }

  async function handleBatchDelete() {
    // 1. 收集选中条目的所有图片路径
    const selectedEntries = allEntries.filter(e => selectedIds.has(e.id))
    const paths = selectedEntries.flatMap(e => e.image_urls ?? []).filter(Boolean)

    try {
      // 2. 并发清理 Storage（失败抛出，不继续删 DB，避免孤儿文件）
      if (paths.length > 0) {
        await Promise.all(paths.map(p => deleteImage(p)))
      }

      // 3. 单次批量 DB 删除
      const { error } = await deleteEntries({ ids: [...selectedIds], userId: user.id })
      if (error) throw error

      const deletedIds = [...selectedIds]
      setAllEntries(prev => prev.filter(entry => !deletedIds.includes(entry.id)))
      setFilteredEntries(prev => prev === null ? prev : prev.filter(entry => !deletedIds.includes(entry.id)))

      // 4. 退出多选，刷新列表
      setShowBatchDeleteConfirm(false)
      setIsSelecting(false)
      setSelectedIds(new Set())
      if (onEntriesMutated) onEntriesMutated()
      else load()
    } catch (err) {
      console.error('批量删除失败', err)
      // 保持确认框和多选状态，用户可重试（Storage 删除幂等，重试安全）
    }
  }

  const handleFilter = useCallback(async ({ searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate }) => {
    const hasFilter = searchText.trim() || selectedEmotions.length ||
                      selectedCategories.length || selectedPeople.length ||
                      selectedCoreNeeds.length || selectedDate
    if (!hasFilter) {
      setFilteredEntries(null)   // 恢复默认列表（含回顾信）
      return
    }

    let query = db.from('journal_entries')
      .select(JOURNAL_ENTRY_FULL_SELECT)
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
    const entries = data ?? []
    primeEntries(entries)
    setFilteredEntries(entries)
  }, [user])

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
          {isSelecting ? (
            <>
              <button
                onClick={() => { setIsSelecting(false); setSelectedIds(new Set()) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, color: '#888' }}
              >
                取消
              </button>
              <span style={{ fontSize: 14, color: '#555' }}>
                已选 {selectedIds.size} 条
              </span>
              <button
                onClick={() => selectedIds.size > 0 && setShowBatchDeleteConfirm(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14,
                  color: selectedIds.size > 0 ? '#c9a96e' : '#ccc',
                }}
              >
                删除
              </button>
            </>
          ) : (
            <>
              <span data-testid="records-page-title" style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>记录</span>
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
            </>
          )}
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

        {/* 图片上传失败 Banner（跨会话持久化） */}
        {uploadFailedBanner && (
          <div style={{
            background: '#fff8f0', border: '1px solid #f0d8b8',
            borderRadius: 10, margin: '8px 14px 0',
            padding: '10px 14px', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: '#a07040' }}>
              有{uploadFailedCount > 1 ? ` ${uploadFailedCount} 条` : ''}图片上传失败，进入记录重新添加
            </span>
            <button
              onClick={() => {
                localStorage.removeItem('image_upload_failed')
                setUploadFailedBanner(false)
              }}
              style={{ background: 'none', border: 'none', color: '#bbb', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
            >✕</button>
          </div>
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

      {/* 回顾信固定入口卡片（多选模式下隐藏） */}
      {!isSelecting && <div style={{ padding: '12px 16px 0' }}>
        {allLetters.length > 0 ? (
          <div
            onClick={() => onOpenLetterList(allLetters)}
            style={{
              background: '#fffdf8',
              border: '1px solid #f0e8d4',
              borderLeft: '3px solid #c9a96e',
              borderRadius: 12, padding: '12px 14px',
              marginBottom: 8, cursor: 'pointer',
              position: 'relative',
            }}
          >
            {/* 未读气泡 */}
            {allLetters.some(l => !l.is_read) && (
              <span style={{
                position: 'absolute', top: 10, right: 12,
                background: '#c9a96e', color: 'white',
                borderRadius: 10, fontSize: 10,
                padding: '1px 7px', fontWeight: 500,
              }}>
                {allLetters.filter(l => !l.is_read).length} 封未读
              </span>
            )}
            {/* 标题行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>✉</span>
              <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>回顾信</span>
              <span style={{ fontSize: 10, color: '#bbb', marginLeft: 2 }}>
                共 {allLetters.length} 封
              </span>
            </div>
            {/* 最新一封节选 */}
            <div style={{
              fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 4,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {(allLetters[0]?.content ?? '').slice(0, 60)}
            </div>
            {/* 期间 */}
            <div style={{ fontSize: 10, color: '#bbb' }}>
              {new Date(allLetters[0]?.period_start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
              {' - '}
              {new Date(allLetters[0]?.period_end).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
              {' · '}{allLetters[0]?.entry_ids?.length ?? 0} 条记录
            </div>
          </div>
        ) : (
          /* 无信时空状态 */
          <div style={{
            background: '#faf8f4', border: '1px dashed #e8e2d8',
            borderRadius: 12, padding: '12px 14px',
            marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>✉</span>
              <span style={{ fontSize: 11, color: '#bbb', fontWeight: 500 }}>回顾信</span>
            </div>
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.6 }}>
              记录满 10 篇后自动生成第一封回顾信
            </div>
          </div>
        )}
      </div>}

      {/* 按日期分组的时间流 */}
      <div data-testid="records-entry-list" style={{ padding: '12px 16px' }}>
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
          groups.map((group, groupIdx) => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <div style={{ fontSize: 11, color: '#bbb', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {group.date}
                  {refreshing && groupIdx === 0 && (
                    <span style={{ color: '#ddd', letterSpacing: 2 }}>……</span>
                  )}
                </div>
                {isSelecting && (() => {
                  const dayIds = group.items.map(i => i.id)
                  const allSelected = dayIds.every(id => selectedIds.has(id))
                  return (
                    <div
                      onClick={() => setSelectedIds(prev => {
                        const next = new Set(prev)
                        if (allSelected) {
                          dayIds.forEach(id => next.delete(id))
                        } else {
                          dayIds.forEach(id => next.add(id))
                        }
                        return next
                      })}
                      style={{
                        width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
                        background: allSelected ? '#c9a96e' : 'none',
                        border: allSelected ? 'none' : '1.5px solid #ddd',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {allSelected && (
                        <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                          <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  )
                })()}
              </div>
              {group.items.map(item => (
                <EntryCard
                  key={item.id}
                  entry={item}
                  onOpen={onOpenDetail}
                  onLongPress={e => {
                    if (isSelecting) return   // 已在多选模式，长按不重复触发
                    setIsSelecting(true)
                    setSelectedIds(new Set([e.id]))
                  }}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={id => setSelectedIds(prev => {
                    const next = new Set(prev)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })}
                />
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
                  onClick={() => { onEdit?.(actionEntry.id); setActionEntry(null) }}
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

      {/* 批量删除确认 sheet */}
      {showBatchDeleteConfirm && (
        <div
          onClick={() => setShowBatchDeleteConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 210,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', background: 'white',
              borderRadius: '16px 16px 0 0',
              padding: '20px 0 env(safe-area-inset-bottom)',
            }}
          >
            <div style={{ padding: '0 20px 16px', fontSize: 15, color: '#333', fontWeight: 500 }}>
              删除 {selectedIds.size} 条记录？
            </div>
            <div style={{ padding: '0 20px 16px', fontSize: 13, color: '#999' }}>
              此操作不可恢复。
            </div>
            <button
              onClick={handleBatchDelete}
              style={{
                width: '100%', padding: '16px 20px', background: 'none',
                border: 'none', textAlign: 'left', fontSize: 15,
                color: '#e05252', cursor: 'pointer', fontWeight: 500,
                borderTop: '1px solid #f5f3ef',
              }}
            >
              确认删除
            </button>
            <button
              onClick={() => setShowBatchDeleteConfirm(false)}
              style={{
                width: '100%', padding: '16px 20px', background: 'none',
                border: 'none', textAlign: 'left', fontSize: 15,
                color: '#bbb', cursor: 'pointer',
              }}
            >
              取消
            </button>
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
                onClick={() => onOpenDetail?.(srcEntry?.id)}
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
