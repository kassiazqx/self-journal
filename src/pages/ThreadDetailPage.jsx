// src/pages/ThreadDetailPage.jsx
// 脉络详情页：mode='confirmed'（默认）或 mode='archived'
// mode=confirmed：··· 菜单（编辑名称/编辑记录/重新分析/归档/删除）+ 编辑关联记录模式
// mode=archived：只读 banner + 底部恢复/永久删除
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import {
  fetchThreadWithEntries,
  updateThread,
  deleteThread,
  refreshArcSummary,
  addEntryToThread,
  reAnalyzeThread,
} from '../lib/threadService'
import FilterBar from '../components/FilterBar'
import { loadContacts } from '../lib/contactsService'
import { loadCoreNeeds } from '../lib/coreNeedsService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadDetailPage({ thread: initialThread, mode = 'confirmed', onBack, onOpenEntry, onArchived, onRestored, onDeleted }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])        // thread_entries 展开后的 journal_entries
  const [rawEntries, setRawEntries] = useState([])  // 含 removed_by_user、added_by 的原始行
  const [loading, setLoading] = useState(true)

  // ··· 菜单
  const [showMenu, setShowMenu] = useState(false)

  // 编辑名称
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(initialThread?.name ?? '')

  // 编辑关联记录模式
  const [editingEntries, setEditingEntries] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  // 默认列表分页
  const [defaultEntries, setDefaultEntries] = useState([])
  const [defaultOffset, setDefaultOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingRef = useRef(false)      // 同步锁，防止并发加载
  const [arcStale, setArcStale] = useState(false)  // 编辑后 arc_summary 过期
  // FilterBar 筛选条件（编辑模式用）
  const [filterConditions, setFilterConditions] = useState(null) // null = 未激活，object = 激活
  const [categoryOptions, setCategoryOptions] = useState([])
  const [peopleOptions, setPeopleOptions]     = useState([])
  const [coreNeedOptions, setCoreNeedOptions] = useState([])

  // 重新分析
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeToast, setReanalyzeToast] = useState('')

  // arc_summary 刷新
  const [refreshing, setRefreshing] = useState(false)

  // 归档确认弹窗
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  // 永久删除确认弹窗（归档态使用）
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => { if (thread?.id) load() }, [thread?.id])

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

  async function load() {
    setLoading(true)
    const { thread: t, entries: e } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setRawEntries(e ?? [])
    setEntries(
      (e ?? [])
        .filter(r => !r.removed_by_user)
        .map(r => ({ ...r.journal_entries, added_by: r.added_by }))
        .filter(Boolean)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    )
    setLoading(false)
  }

  // ── 编辑名称 ──────────────────────────────────────────────────
  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === thread.name) { setEditingName(false); setNameInput(thread.name); return }
    await updateThread(thread.id, user.id, { name: trimmed })
    setThread(prev => ({ ...prev, name: trimmed }))
    setEditingName(false)
  }

  // ── arc_summary 刷新 ──────────────────────────────────────────
  async function handleRefreshArc() {
    if (refreshing) return
    setRefreshing(true)
    await refreshArcSummary(thread.id, user.id)
    const { thread: t } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setArcStale(false)
    setRefreshing(false)
  }

  // ── 编辑关联记录：加载默认列表（按时间倒序，每页 30 条）─────
  async function loadDefaultEntries(offset = 0) {
    if (loadingRef.current) return   // 同步锁：防止并发
    loadingRef.current = true
    setLoadingMore(true)
    const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
    const { data } = await db.from('journal_entries')
      .select('id, entry_summary, created_at, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + 29)
    const filtered = (data ?? []).filter(e => !allExistingIds.has(e.id))
    if (offset === 0) {
      setDefaultEntries(filtered)
    } else {
      setDefaultEntries(prev => [...prev, ...filtered])
    }
    setHasMore((data ?? []).length === 30)
    setDefaultOffset(offset)
    loadingRef.current = false
    setLoadingMore(false)
  }

  async function loadMore() {
    await loadDefaultEntries(defaultOffset + 30)
  }

  // 滚动触底自动加载（只在编辑模式 + 搜索框为空时生效）
  function handleScroll(e) {
    if (!editingEntries || !hasMore || loadingRef.current || searchQuery.trim() || filterConditions) return
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 150) {
      loadMore()
    }
  }

  // ── 编辑关联记录：搜索 ────────────────────────────────────────
  useEffect(() => {
    if (!editingEntries) return
    if (!searchQuery.trim()) {
      setSearchResults([])
      // 有 FilterBar 筛选条件时，不重载默认列表（FilterBar 自己管理结果）
      if (!filterConditions) {
        loadDefaultEntries(0)
      }
      return
    }
    const timer = setTimeout(() => doSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, editingEntries, filterConditions])

  async function doSearch(q) {
    setSearching(true)
    const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
    const { data } = await db.from('journal_entries')
      .select('id, entry_summary, created_at, content')
      .eq('user_id', user.id)
      .or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%`)
      .order('created_at', { ascending: false })
      .limit(30)
    // 排除已在 entries 中的（含 removed_by_user=true 的也排除，避免重复）
    const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
    setSearchResults((data ?? []).filter(e => !allExistingIds.has(e.id)))
    setSearching(false)
  }

  // 编辑模式：FilterBar 的 onFilter 回调
  // 有任意条件 → 执行筛选查询；无条件 → 恢复默认列表
  async function handleFilter({ searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate }) {
    const hasFilter = searchText.trim() || selectedEmotions.length ||
                      selectedCategories.length || selectedPeople.length ||
                      selectedCoreNeeds.length || selectedDate
    if (!hasFilter) {
      setFilterConditions(null)
      setSearchResults([])
      loadDefaultEntries(0)
      return
    }

    setFilterConditions({ searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate })
    setSearching(true)

    const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))

    let query = db.from('journal_entries')
      .select('id, entry_summary, created_at, content, emotions, category_tags, people_involved, core_needs')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

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
    setSearchResults((data ?? []).filter(e => !allExistingIds.has(e.id)))
    setSearching(false)
  }

  // ── 编辑关联记录：移除（软删除 removed_by_user=true）────────
  async function handleRemoveEntry(entryId) {
    await db.from('thread_entries')
      .update({ removed_by_user: true })
      .eq('thread_id', thread.id)
      .eq('entry_id', entryId)
    setEntries(prev => prev.filter(e => e.id !== entryId))
    setRawEntries(prev => prev.map(r => r.entry_id === entryId ? { ...r, removed_by_user: true } : r))
    setArcStale(true)
  }

  // ── 编辑关联记录：添加 ────────────────────────────────────────
  async function handleAddEntry(entry) {
    await addEntryToThread(thread.id, entry.id, 'user')
    setEntries(prev => [{ ...entry, added_by: 'user' }, ...prev])
    setRawEntries(prev => [...prev, { thread_id: thread.id, entry_id: entry.id, added_by: 'user', removed_by_user: false, journal_entries: entry }])
    setSearchResults(prev => prev.filter(e => e.id !== entry.id))
    setDefaultEntries(prev => prev.filter(e => e.id !== entry.id))
    setArcStale(true)
  }

  // ── 重新分析 ──────────────────────────────────────────────────
  async function handleReAnalyze() {
    setShowMenu(false)
    if (reanalyzing) return
    setReanalyzing(true)
    const { newCount, error } = await reAnalyzeThread(thread.id, user.id)
    setReanalyzing(false)
    if (error) {
      setReanalyzeToast('分析失败，请检查网络')
    } else if (newCount > 0) {
      setReanalyzeToast(`发现 ${newCount} 条新关联记录，已加入候选`)
      await load()
    } else {
      setReanalyzeToast('没有发现新的关联记录')
    }
    setTimeout(() => setReanalyzeToast(''), 3000)
  }

  // ── 归档 ──────────────────────────────────────────────────────
  async function handleArchive() {
    setShowArchiveConfirm(false)
    await updateThread(thread.id, user.id, { status: 'archived' })
    onArchived?.(thread)
  }

  // ── 永久删除（归档态）─────────────────────────────────────────
  async function handlePermanentDelete() {
    setShowDeleteConfirm(false)
    await deleteThread(thread.id, user.id)
    onDeleted?.(thread)
  }

  // ── 恢复（归档态）────────────────────────────────────────────
  async function handleRestore() {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    onRestored?.(thread)
  }

  const isArchived = mode === 'archived'

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
        }}>
          ‹
        </button>

        {/* 标题（归档态灰色 + 角标，已确认可点击编辑） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {editingName ? (
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus
              onBlur={handleSaveName} onKeyDown={e => { if (e.key === 'Enter') handleSaveName() }}
              style={{ fontSize: 15, fontWeight: 600, border: 'none', borderBottom: '1px solid #c9a96e', outline: 'none', background: 'transparent', textAlign: 'center', width: 160, fontFamily: 'inherit', color: '#333' }} />
          ) : (
            <span onClick={isArchived ? undefined : () => { setEditingName(true); setNameInput(thread.name) }}
              style={{ fontSize: 15, fontWeight: 600, color: isArchived ? '#999' : '#333', cursor: isArchived ? 'default' : 'pointer' }}>
              {thread?.name}
            </span>
          )}
          {isArchived && (
            <span style={{ fontSize: 10, background: '#f0ece4', color: '#aaa', padding: '2px 8px', borderRadius: 10 }}>已归档</span>
          )}
        </div>

        {/* 右侧：··· 菜单（仅已确认态） */}
        {!isArchived ? (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu(v => !v)}
              style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>
              ···
            </button>
            {showMenu && (
              <>
                <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 154, overflow: 'hidden' }}>
                  {[
                    { label: '✏️ 编辑名称', action: () => { setShowMenu(false); setEditingName(true); setNameInput(thread.name) }, color: '#333' },
                    { label: '📝 编辑关联记录', action: () => { setShowMenu(false); setEditingEntries(true) }, color: '#333' },
                    { label: reanalyzing ? '🔄 分析中…' : '🔄 重新分析', action: handleReAnalyze, color: '#333' },
                    { label: '📁 归档', action: () => { setShowMenu(false); setShowArchiveConfirm(true) }, color: '#e07850' },
                    { label: '🗑️ 删除', action: () => { setShowMenu(false); setShowDeleteConfirm(true) }, color: '#e05252' },
                  ].map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: item.color, cursor: 'pointer', borderBottom: i < 4 ? '1px solid #f5f3ef' : 'none' }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ width: 40 }} />
        )}
      </div>

      {/* 归档只读 banner */}
      {isArchived && (
        <div style={{ background: '#f5f3ef', borderBottom: '1px solid #ede9e2', padding: '10px 18px', fontSize: 12, color: '#aaa', textAlign: 'center' }}>
          📁 已归档 · 归档于 {formatDate(thread.updated_at)} · 仅供查看
        </div>
      )}

      {/* 编辑关联记录 banner */}
      {editingEntries && (
        <div style={{ background: '#fff3e8', borderBottom: '1px solid #f0d4b0', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: '#e07850', fontWeight: 500 }}>编辑关联记录</span>
          <button onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]); setFilterConditions(null); setDefaultEntries([]); setDefaultOffset(0); setHasMore(true) }}
            style={{ fontSize: 13, color: '#c9a96e', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>
            完成
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }} onScroll={handleScroll}>

        {/* ── 编辑模式：已关联记录（上方，可移除）── */}
        {editingEntries && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>已关联记录（{entries.length}）</div>
            {entries.length === 0 ? (
              <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>暂无关联记录</div>
            ) : entries.map(entry => (
              <div key={entry.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#bbb', marginBottom: 2 }}>{formatDate(entry.created_at)}</div>
                  <div style={{ fontSize: 13, color: '#333', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {entry.entry_summary ?? '（暂无摘要）'}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); handleRemoveEntry(entry.id) }}
                  style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: '#fde8e8', border: '1.5px solid #e57373', color: '#e05252', fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ×
                </button>
              </div>
            ))}
            <div style={{ height: 1, background: '#ede9e2', margin: '12px 0' }} />
          </div>
        )}

        {/* ── 未关联记录（搜索框始终在顶，下方根据搜索词显示结果或默认列表）── */}
        {editingEntries && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>未关联记录</div>

            {/* FilterBar 搜索 + 情绪/类型/人物/需求筛选（showDate=false） */}
            <FilterBar
              onFilter={handleFilter}
              categoryOptions={categoryOptions}
              peopleOptions={peopleOptions}
              coreNeedOptions={coreNeedOptions}
              placeholder="搜索记录内容…"
              showDate={false}
            />

            {/* 搜索结果（有搜索词 或 有筛选条件时） */}
            {(searchQuery.trim() || filterConditions) && (
              <>
                {searching ? (
                  <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>搜索中…</div>
                ) : searchResults.length === 0 ? (
                  <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>没有找到匹配的记录</div>
                ) : searchResults.map(entry => (
                  <div key={entry.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#bbb', marginBottom: 2 }}>{formatDate(entry.created_at)}</div>
                      <div style={{ fontSize: 13, color: '#333', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {entry.entry_summary ?? entry.content?.slice(0, 60) ?? ''}
                      </div>
                    </div>
                    <button onClick={() => handleAddEntry(entry)}
                      style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: '#e8f5e9', border: '1.5px solid #81c784', color: '#43a047', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      +
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* 默认列表（搜索框为空 且 无筛选条件时） */}
            {!searchQuery.trim() && !filterConditions && (
              <>
                {defaultEntries.length === 0 && loadingMore ? (
                  <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>加载中…</div>
                ) : defaultEntries.length === 0 ? (
                  <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>暂无可添加的记录</div>
                ) : defaultEntries.map(entry => (
                  <div key={entry.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#bbb', marginBottom: 2 }}>{formatDate(entry.created_at)}</div>
                      <div style={{ fontSize: 13, color: '#333', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {entry.entry_summary ?? entry.content?.slice(0, 60) ?? ''}
                      </div>
                    </div>
                    <button onClick={() => handleAddEntry(entry)}
                      style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: '#e8f5e9', border: '1.5px solid #81c784', color: '#43a047', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      +
                    </button>
                  </div>
                ))}
                {loadingMore && defaultEntries.length > 0 && (
                  <div style={{ color: '#ccc', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>加载中…</div>
                )}
                {!hasMore && defaultEntries.length > 0 && (
                  <div style={{ color: '#ddd', fontSize: 11, textAlign: 'center', padding: '6px 0 12px' }}>已加载全部</div>
                )}
                {hasMore && !loadingMore && defaultEntries.length > 0 && (
                  <button onClick={loadMore}
                    style={{ display: 'block', width: '100%', padding: '10px', background: 'none', border: '1px solid #e0dbd4', borderRadius: 8, color: '#aaa', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                    加载更多 ↓
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 正常查看模式：变化轨迹 + 关联记录 ── */}
        {!editingEntries && (<>

        {/* arc_summary 区 */}
        <div style={{ background: isArchived ? '#f5f3ef' : '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>变化轨迹</span>
            {!isArchived && thread?.arc_updated_at && (
              <span style={{ fontSize: 10, color: '#ccc' }}>AI 生成轨迹 · {formatDate(thread.arc_updated_at)}</span>
            )}
          </div>
          {/* arc_summary 过期警告 */}
          {arcStale && !isArchived && (
            <div style={{ fontSize: 12, color: '#e07850', marginBottom: 8 }}>
              ⚠ 关联记录已更改，AI 轨迹摘要尚未更新
              <button onClick={handleRefreshArc} disabled={refreshing}
                style={{ marginLeft: 8, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                {refreshing ? '生成中…' : '点击重新生成轨迹 ›'}
              </button>
            </div>
          )}
          {thread?.arc_summary ? (
            <div style={{ fontSize: 13, color: isArchived ? '#888' : '#555', lineHeight: 1.75 }}>
              {thread.arc_summary}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65 }}>
              {entries.length < 2 ? '关联 2 条以上记录后可生成变化轨迹' : '点击右上角「···」→「🔄 重新分析」生成变化轨迹'}
            </div>
          )}
          {!arcStale && !isArchived && (
            <button onClick={handleRefreshArc} disabled={refreshing || entries.length < 2}
              style={{ marginTop: 8, fontSize: 11, color: refreshing ? '#ccc' : '#c9a96e', background: 'none', border: 'none', cursor: entries.length >= 2 && !refreshing ? 'pointer' : 'default', padding: 0 }}>
              {refreshing ? '生成中…' : entries.length >= 2 ? '↻ 更新轨迹' : ''}
            </button>
          )}
        </div>

        {/* 关联记录列表 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>加载中…</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>暂无关联记录</div>
        ) : entries.map(entry => (
          <div key={entry.id}
            onClick={() => onOpenEntry?.(entry)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', opacity: isArchived ? 0.85 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#bbb' }}>{formatDate(entry.created_at)}</span>
                <span style={{ fontSize: 10, color: '#c9a96e', background: '#fff8f0', padding: '1px 6px', borderRadius: 8 }}>
                  {entry.added_by === 'user' ? '我手动添加' : 'AI 关联'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {entry.entry_summary ?? '（暂无摘要）'}
              </div>
            </div>
          </div>
        ))}
        </>)}
      </div>

      {/* 归档态底部固定操作栏 */}
      {isArchived && (
        <div style={{ padding: '12px 18px 28px', background: '#faf8f4', borderTop: '1px solid #ede9e2', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={handleRestore}
            style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#555', fontSize: 14, cursor: 'pointer' }}>
            ↩ 恢复为活跃脉络
          </button>
          <button onClick={() => setShowDeleteConfirm(true)}
            style={{ flex: 1, padding: '12px', border: '1px solid #fdd', borderRadius: 10, background: 'white', color: '#e05252', fontSize: 14, cursor: 'pointer' }}>
            永久删除
          </button>
        </div>
      )}

      {/* 归档确认弹窗 */}
      {showArchiveConfirm && (
        <div onClick={() => setShowArchiveConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: '24px 20px', width: 280, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 10 }}>归档这条脉络？</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.6 }}>归档后可在「已归档」Tab 查看，随时可以恢复</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowArchiveConfirm(false)}
                style={{ flex: 1, padding: '10px', border: '1px solid #e0dbd4', borderRadius: 8, background: 'white', color: '#888', cursor: 'pointer' }}>取消</button>
              <button onClick={handleArchive}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 8, background: '#e07850', color: 'white', fontWeight: 500, cursor: 'pointer' }}>确认归档</button>
            </div>
          </div>
        </div>
      )}

      {/* 永久删除确认弹窗 */}
      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: '24px 20px', width: 280, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 10 }}>永久删除这条脉络？</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 4, lineHeight: 1.6 }}>
              脉络及其 {entries.length} 条关联关系将被永久删除
            </div>
            <div style={{ fontSize: 12, color: '#bbb', marginBottom: 20 }}>原始笔记不受影响 · 操作不可撤销</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: '10px', border: '1px solid #e0dbd4', borderRadius: 8, background: 'white', color: '#888', cursor: 'pointer' }}>取消</button>
              <button onClick={handlePermanentDelete}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 8, background: '#e05252', color: 'white', fontWeight: 500, cursor: 'pointer' }}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 重新分析 Toast */}
      {reanalyzeToast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {reanalyzeToast}
        </div>
      )}
    </div>
  )
}
