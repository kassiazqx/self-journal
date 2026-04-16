# 全局搜索 + 筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 FilterBar 共享组件，在 RecordsPage 加入🔍入口和三维筛选，在 ThreadDetailPage 编辑模式加入情绪/类型筛选。

**Architecture:** FilterBar.jsx 负责 UI 与状态，通过 `onFilter` 回调把筛选条件传给父页面；父页面负责 Supabase 查询。FilterBar 内部用 `useAuth()` 获取 userId，不接受 userId prop。数组字段用 `.overlaps()` 查询，绕开 §4.24 的 `::text` cast 限制。

**Tech Stack:** React hooks, Supabase JS (`db.from`, `.overlaps`, `.gte`, `.lte`), `EMOTION_BASE` from emotionMap.js

---

## 文件清单

| 文件 | 操作 |
|---|---|
| `src/components/FilterBar.jsx` | 新建 |
| `src/pages/RecordsPage.jsx` | 修改：加🔍入口、FilterBar、handleFilter 查询 |
| `src/pages/ThreadDetailPage.jsx` | 修改：编辑模式加 FilterBar（showDate=false） |

---

### Task 1：新建 FilterBar.jsx

**Files:**
- Create: `src/components/FilterBar.jsx`

- [ ] **Step 1：新建文件，写入完整组件**

```jsx
// src/components/FilterBar.jsx
// 搜索框 + 情绪/类型/日期筛选器，通过 onFilter 回调通知父页面
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'

// 情绪分组（顺序：正面 → 混合/中性 → 负面）
const EMOTION_POSITIVE = ['轻松','满足','感激','开心','平静','期待','温暖','喜悦','自豪','踏实','安心','充实','兴奋','爱','敬畏','信任','被信任','悲悯','敬佩','欣赏']
const EMOTION_MIXED    = ['迷茫','矛盾','好奇','纠结','释然','依恋','敏感','复杂','惊讶','无聊','尴尬','怀念','同情','渴望']
const EMOTION_NEGATIVE = ['难过','愤怒','委屈','焦虑','羞愧','无力','害怕','孤独','绝望','沮丧','厌烦','烦躁','压抑','紧张','失落','嫉妒','内疚','抗拒','疲惫','麻木','不甘','崩溃','厌恶','悲痛','羞耻','轻视','后悔']

export default function FilterBar({
  onFilter,
  categoryOptions = [],
  placeholder = '搜索内容…',
  showDate = true,
}) {
  const { user } = useAuth()

  const [searchText, setSearchText]               = useState('')
  const [selectedEmotions, setSelectedEmotions]   = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedDate, setSelectedDate]           = useState(null)
  const [showEmotionMenu, setShowEmotionMenu]     = useState(false)
  const [showCategoryMenu, setShowCategoryMenu]   = useState(false)
  const [showCalendar, setShowCalendar]           = useState(false)

  const now = new Date()
  const [calendarYear, setCalendarYear]   = useState(now.getFullYear())
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth())
  const [datesWithRecords, setDatesWithRecords] = useState(new Set())

  const searchTimer = useRef(null)

  // 任何筛选条件变化时通知父页面（搜索框 300ms 防抖）
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      onFilter({ searchText, selectedEmotions, selectedCategories, selectedDate })
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [searchText, selectedEmotions, selectedCategories, selectedDate])

  // 月历展开或切换月份时，查询当月哪些天有记录
  useEffect(() => {
    if (!showCalendar || !user) return
    fetchDatesWithRecords()
  }, [showCalendar, calendarYear, calendarMonth])

  async function fetchDatesWithRecords() {
    const start = new Date(calendarYear, calendarMonth, 1).toISOString()
    const end   = new Date(calendarYear, calendarMonth + 1, 0, 23, 59, 59).toISOString()
    const { data } = await db.from('journal_entries')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', start)
      .lte('created_at', end)
    setDatesWithRecords(new Set(
      (data ?? []).map(r => {
        const d = new Date(r.created_at)  // 转设备本地时间
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      })
    ))
  }

  function toggleEmotion(e) {
    setSelectedEmotions(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }
  function toggleCategory(c) {
    setSelectedCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }
  function handleDateClick(date) {
    setSelectedDate(prev => prev && prev.toDateString() === date.toDateString() ? null : date)
  }
  function prevMonth() {
    if (calendarMonth === 0) { setCalendarYear(y => y - 1); setCalendarMonth(11) }
    else setCalendarMonth(m => m - 1)
  }
  function nextMonth() {
    if (calendarMonth === 11) { setCalendarYear(y => y + 1); setCalendarMonth(0) }
    else setCalendarMonth(m => m + 1)
  }

  const today = new Date()
  const firstDayOfWeek = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7 // 周一为0
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate()

  const chipStyle = (active) => ({
    flexShrink: 0, padding: '4px 10px', borderRadius: 20,
    border: '1px solid #e0dbd4', cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? '#c9a96e' : 'white',
    color: active ? 'white' : '#666', fontSize: 12,
  })
  const selectedChipStyle = {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 20,
    background: '#f0e8d4', fontSize: 12, color: '#8a7a5a',
  }
  const emotionBtnStyle = (selected) => ({
    padding: '4px 10px', borderRadius: 20, border: '1px solid #e0dbd4',
    cursor: 'pointer', fontSize: 12,
    background: selected ? '#c9a96e' : '#f5f3ef',
    color: selected ? 'white' : '#555',
  })

  return (
    <div style={{ background: '#faf8f4', borderBottom: '1px solid #ede9e2' }}>

      {/* 搜索框 */}
      <div style={{ padding: '10px 16px 0' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={placeholder}
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 32px 8px 12px', fontSize: 13,
              outline: 'none', background: 'white', fontFamily: 'inherit',
            }}
          />
          {searchText && (
            <button onClick={() => setSearchText('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 筛选 chip 行（横向可滚动） */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', overflowX: 'auto' }}>
        {/* 情绪 */}
        <button style={chipStyle(showEmotionMenu)}
          onClick={() => { setShowEmotionMenu(v => !v); setShowCategoryMenu(false); setShowCalendar(false) }}>
          情绪 ▾
        </button>
        {selectedEmotions.map(e => (
          <span key={e} style={selectedChipStyle}>
            {e}
            <button onClick={() => toggleEmotion(e)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
          </span>
        ))}

        {/* 类型 */}
        <button style={chipStyle(showCategoryMenu)}
          onClick={() => { setShowCategoryMenu(v => !v); setShowEmotionMenu(false); setShowCalendar(false) }}>
          类型 ▾
        </button>
        {selectedCategories.map(c => (
          <span key={c} style={selectedChipStyle}>
            {c}
            <button onClick={() => toggleCategory(c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
          </span>
        ))}

        {/* 日期（仅 showDate=true） */}
        {showDate && <>
          <button style={chipStyle(showCalendar)}
            onClick={() => { setShowCalendar(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false) }}>
            日期 ▾
          </button>
          {selectedDate && (
            <span style={selectedChipStyle}>
              {selectedDate.getMonth()+1}月{selectedDate.getDate()}日
              <button onClick={() => setSelectedDate(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
            </span>
          )}
        </>}
      </div>

      {/* 情绪浮层 */}
      {showEmotionMenu && (
        <>
          <div onClick={() => setShowEmotionMenu(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'relative', zIndex: 11, margin: '0 16px 8px',
            background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: 12, maxHeight: 280, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button onClick={() => setShowEmotionMenu(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EMOTION_POSITIVE.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid #ede9e2', margin: '8px 0' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EMOTION_MIXED.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid #ede9e2', margin: '8px 0' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EMOTION_NEGATIVE.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
            </div>
          </div>
        </>
      )}

      {/* 类型浮层 */}
      {showCategoryMenu && (
        <>
          <div onClick={() => setShowCategoryMenu(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'relative', zIndex: 11, margin: '0 16px 8px',
            background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button onClick={() => setShowCategoryMenu(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {categoryOptions.length === 0
                ? <span style={{ fontSize: 12, color: '#bbb' }}>暂无标签，请先在「我的」中添加</span>
                : categoryOptions.map(c => <button key={c} style={emotionBtnStyle(selectedCategories.includes(c))} onClick={() => toggleCategory(c)}>{c}</button>)
              }
            </div>
          </div>
        </>
      )}

      {/* 内联月历 */}
      {showDate && showCalendar && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888' }}>‹</button>
            <span style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>
              {calendarYear}年{calendarMonth + 1}月
            </span>
            <button onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
            {['一','二','三','四','五','六','日'].map(d => (
              <span key={d} style={{ fontSize: 11, color: '#bbb' }}>{d}</span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const date = new Date(calendarYear, calendarMonth, day)
              const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const hasRecord = datesWithRecords.has(dateStr)
              const isToday    = date.toDateString() === today.toDateString()
              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString()
              return (
                <button key={day} onClick={() => handleDateClick(date)}
                  style={{
                    width: '100%', aspectRatio: '1', borderRadius: '50%',
                    border: 'none', cursor: 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? '#c9a96e' : 'transparent',
                    color: isSelected ? 'white' : isToday ? '#c9a96e' : hasRecord ? '#333' : '#ccc',
                    boxShadow: isToday && !isSelected ? 'inset 0 0 0 1.5px #c9a96e' : 'none',
                    fontWeight: isSelected || isToday ? 600 : 400,
                  }}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：构建检查**

```bash
npm run build
```
预期：无报错。

---

### Task 2：修改 RecordsPage.jsx

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

- [ ] **Step 1：在 import 行末尾加入 FilterBar**

在文件顶部已有的 import 区域末尾追加：

```jsx
import FilterBar from '../components/FilterBar'
```

- [ ] **Step 2：在 RecordsPage 组件 state 区新增三个 state**

找到现有 state 声明区（`const [allEntries, setAllEntries]` 那一块），在其后追加：

```jsx
  // 搜索 + 筛选
  const [showSearch, setShowSearch]         = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [filteredEntries, setFilteredEntries] = useState(null) // null = 无筛选，[] = 筛选结果空
```

- [ ] **Step 3：加载用户 categoryOptions（挂载时查一次）**

在现有的 `useEffect(() => { load() }, [load])` 下方，追加：

```jsx
  // 加载内容类型标签（用于 FilterBar categoryOptions）
  useEffect(() => {
    if (!user) return
    db.from('user_options')
      .select('option_value')
      .eq('user_id', user.id)
      .eq('field_name', 'content_category')
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCategoryOptions((data ?? []).map(r => r.option_value)))
  }, [user?.id])
```

- [ ] **Step 4：实现 handleFilter 函数**

在 `handleDelete` 函数下方追加（不要修改 handleDelete）：

```jsx
  async function handleFilter({ searchText, selectedEmotions, selectedCategories, selectedDate }) {
    const hasFilter = searchText.trim() || selectedEmotions.length ||
                      selectedCategories.length || selectedDate
    if (!hasFilter) {
      setFilteredEntries(null)   // 恢复默认列表（含回顾信）
      return
    }

    let query = db.from('journal_entries')
      .select('id, content, entry_summary, created_at, emotions, emotion_display, category_tags, template_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (searchText.trim()) {
      const escaped = searchText.replace(/%/g, '\\%').replace(/_/g, '\\_')
      query = query.or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%`)
    }
    if (selectedEmotions.length) {
      query = query.overlaps('emotions', selectedEmotions)
    }
    if (selectedCategories.length) {
      query = query.overlaps('category_tags', selectedCategories)
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
```

- [ ] **Step 5：修改 return 区域 —— 加顶部 header + FilterBar**

找到 return 里最外层的 `<div>` 开标签（当前是第 239 行）：

```jsx
    <div style={{ flex: 1, overflowY: 'auto', background: '#f5f3ef' }} onScroll={handleScroll}>
```

将其替换为带 sticky header 的结构（整段 return 改为如下，只改外壳，内容保留）：

```jsx
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
            placeholder="搜索记录内容…"
            showDate={true}
          />
        )}
      </div>

      {/* 可滚动内容区 */}
      <div style={{ flex: 1, overflowY: 'auto' }} onScroll={filteredEntries === null ? handleScroll : undefined}>
```

- [ ] **Step 6：修改未读回顾信横幅的位置（移入滚动区域顶部）**

未读回顾信横幅已经在滚动区下方，检查它紧跟在上面新开的 `<div style={{ flex: 1, overflowY: 'auto' }}>` 之后，顺序不变。如果原来横幅在最外层 `<div>` 直接子元素，需确认它在新的内层滚动 div 里。原始代码横幅在 `onScroll` div 内部第一个子节点，无需改动位置。

- [ ] **Step 7：修改列表区域 —— 筛选模式下只显示 journal_entries，隐藏回顾信**

找到当前按日期分组的列表渲染区。目前 `items` 变量合并了 entries + letters。需要根据 `filteredEntries` 是否为 null 来决定渲染内容。

在 `items` 变量声明处（当前约 153–156 行）修改为：

```jsx
  // filteredEntries !== null → 筛选模式：只显示筛选出的 journal_entries，不含回顾信
  const items = filteredEntries !== null
    ? filteredEntries.map(e => ({ ...e, _type: 'entry', _sortKey: e.created_at }))
    : [
        ...allEntries.map(e => ({ ...e, _type: 'entry',  _sortKey: e.created_at })),
        ...allLetters.map(l => ({ ...l, _type: 'letter', _sortKey: l.period_end })),
      ].sort((a, b) => new Date(b._sortKey) - new Date(a._sortKey))
```

- [ ] **Step 8：修改空状态文案，筛选模式有专属提示**

找到 `groups.length === 0` 的空状态渲染，改为：

```jsx
        ) : groups.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc',
            fontSize: 14, padding: '60px 0' }}>
            {filteredEntries !== null ? '没有符合条件的记录' : '还没有记录，去写第一条吧'}
          </div>
```

- [ ] **Step 9：在最外层 div 关标签前补一个 `</div>` 闭合新增的滚动内层 div**

原本最外层 `</div>` 就是 `onScroll` div 的关标签。现在它变成了内层滚动 div（Step 5 改了）。确认 return 末尾结构为：

```jsx
      </div>  {/* 滚动内容区 */}
    </div>    {/* 最外层 flex 容器 */}
```

即：原来的 `</div>` → 现在是内层滚动 div 的关标签，再在它后面加一个 `</div>` 关闭最外层 flex 容器。

- [ ] **Step 10：构建检查**

```bash
npm run build
```
预期：无报错。

---

### Task 3：修改 ThreadDetailPage.jsx

**Files:**
- Modify: `src/pages/ThreadDetailPage.jsx`

- [ ] **Step 1：在 import 行末尾加入 FilterBar**

在文件顶部已有的 import 区域末尾追加：

```jsx
import FilterBar from '../components/FilterBar'
```

- [ ] **Step 2：在编辑关联记录 state 区新增筛选相关 state**

找到编辑关联记录 state 区（`const [searchQuery, setSearchQuery]` 那一块），在其后追加：

```jsx
  // FilterBar 筛选条件（编辑模式用）
  const [filterConditions, setFilterConditions] = useState(null) // null = 未激活，object = 激活
```

- [ ] **Step 3：新增 handleFilter 函数（合并文字搜索 + 多维筛选）**

在现有 `doSearch` 函数下方追加：

```jsx
  // 编辑模式：FilterBar 的 onFilter 回调
  // 有任意条件 → 执行筛选查询；无条件 → 恢复默认列表
  async function handleFilter({ searchText, selectedEmotions, selectedCategories, selectedDate }) {
    const hasFilter = searchText.trim() || selectedEmotions.length ||
                      selectedCategories.length || selectedDate
    if (!hasFilter) {
      setFilterConditions(null)
      setSearchResults([])
      loadDefaultEntries(0)
      return
    }

    setFilterConditions({ searchText, selectedEmotions, selectedCategories, selectedDate })
    setSearching(true)

    const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))

    let query = db.from('journal_entries')
      .select('id, entry_summary, created_at, content, emotions, category_tags')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (searchText.trim()) {
      const escaped = searchText.replace(/%/g, '\\%').replace(/_/g, '\\_')
      query = query.or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%`)
    }
    if (selectedEmotions.length) {
      query = query.overlaps('emotions', selectedEmotions)
    }
    if (selectedCategories.length) {
      query = query.overlaps('category_tags', selectedCategories)
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
```

- [ ] **Step 4：修改「完成」按钮的 onClick，清空 filterConditions**

找到「完成」按钮（约第 294 行）：

```jsx
          <button onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]); setDefaultEntries([]); setDefaultOffset(0); setHasMore(true) }}
```

改为：

```jsx
          <button onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]); setFilterConditions(null); setDefaultEntries([]); setDefaultOffset(0); setHasMore(true) }}
```

- [ ] **Step 5：修改编辑模式的 useEffect，有 filterConditions 时不触发默认列表加载**

找到现有的 searchQuery 监听 useEffect（约第 137–147 行）：

```jsx
  useEffect(() => {
    if (!editingEntries) return
    if (!searchQuery.trim()) {
      setSearchResults([])
      // 进入编辑模式或清空搜索时，加载默认列表
      loadDefaultEntries(0)
      return
    }
    const timer = setTimeout(() => doSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, editingEntries])
```

改为（加入 filterConditions 判断，避免 FilterBar 激活时被覆盖）：

```jsx
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
```

- [ ] **Step 6：在搜索框和未关联记录列表之间插入 FilterBar**

找到编辑模式下「未关联记录」区块的搜索框（约第 334–338 行）：

```jsx
            {/* 搜索框（始终置顶） */}
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索记录内容…"
              style={{ width: '100%', border: '1px solid #e0dbd4', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 10 }}
            />
```

在该 `<input>` 下方（`marginBottom: 10` 结束后），插入 FilterBar（注意：此处用 categoryOptions state，需从 user_options 加载）：

```jsx
            {/* FilterBar 情绪/类型筛选（showDate=false） */}
            <FilterBar
              onFilter={handleFilter}
              categoryOptions={categoryOptions}
              placeholder=""
              showDate={false}
            />
```

其中 `categoryOptions` 需要在 ThreadDetailPage 也加载：

**在 ThreadDetailPage state 区**追加：

```jsx
  const [categoryOptions, setCategoryOptions] = useState([])
```

**在 `useEffect(() => { if (thread?.id) load() }, [thread?.id])` 下方**追加：

```jsx
  // 加载内容类型标签（用于 FilterBar categoryOptions）
  useEffect(() => {
    if (!user) return
    db.from('user_options')
      .select('option_value')
      .eq('user_id', user.id)
      .eq('field_name', 'content_category')
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCategoryOptions((data ?? []).map(r => r.option_value)))
  }, [user?.id])
```

- [ ] **Step 7：修改未关联记录的显示逻辑，有 FilterBar 筛选时用 searchResults**

找到「搜索结果（有搜索词时）」和「默认列表（搜索框为空时）」的条件分支（约第 342–392 行）。

当前逻辑：
- `searchQuery.trim()` 存在 → 显示 `searchResults`
- `!searchQuery.trim()` → 显示 `defaultEntries`

新逻辑：把 `filterConditions` 也纳入「显示搜索结果」的条件：

```jsx
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
                {/* 加载更多提示 */}
                {loadingMore && defaultEntries.length > 0 && (
                  <div style={{ color: '#ccc', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>加载中…</div>
                )}
                {!hasMore && defaultEntries.length > 0 && (
                  <div style={{ color: '#ddd', fontSize: 11, textAlign: 'center', padding: '6px 0 12px' }}>已加载全部</div>
                )}
              </>
            )}
```

**注意：** 此处完整替换原来的两段条件渲染（`{searchQuery.trim() && ...}` 和 `{!searchQuery.trim() && ...}`）。原来的"加载更多"提示也一并合并进来，不要保留原来的分散写法。

- [ ] **Step 8：修改 handleScroll，有 filterConditions 时也不触发加载**

找到 `handleScroll` 函数（约第 128–134 行）：

```jsx
  function handleScroll(e) {
    if (!editingEntries || !hasMore || loadingRef.current || searchQuery.trim()) return
```

改为：

```jsx
  function handleScroll(e) {
    if (!editingEntries || !hasMore || loadingRef.current || searchQuery.trim() || filterConditions) return
```

- [ ] **Step 9：构建检查**

```bash
npm run build
```
预期：无报错。

---

### Task 4：手动验证 + 提交

**Files:** 无新建/修改（验证步骤）

- [ ] **Step 1：启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2：RecordsPage 验证清单（逐条手动操作）**

1. 打开「记录」页 → 右上角有 🔍 图标，无 header 文字「记录」时检查 Step 5 是否少了 span
2. 点击 🔍 → FilterBar 出现（搜索框 + 情绪/类型/日期 chip 行）
3. 输入文字 → 300ms 后列表更新（只含 journal_entries，无回顾信卡片）
4. 点「情绪 ▾」→ 浮层展开，正面/混合/负面三组，横线分隔，✅ 按钮可关闭
5. 选一个情绪词（如「焦虑」）→ chip 行出现「焦虑 ✕」chip，列表只显示含「焦虑」的记录
6. 点「类型 ▾」选一个类型 → 列表进一步缩小（AND 逻辑）
7. 点「情绪」已选词右边的 ✕ → 移除该情绪，列表更新
8. 点「日期 ▾」→ 月历内联展开，有记录日期字体黑色，无记录浅灰，今天金色圆圈
9. 点某天 → 该日期 chip 出现，列表只显示当天记录；月历不自动收起
10. 再次点同一天 → 取消日期筛选，chip 消失
11. ← / → 箭头切换月份 → 月历更新，点后重新查询 datesWithRecords
12. 点右上角 ✕ → FilterBar 收起，所有筛选清空，回到完整列表（含回顾信）

- [ ] **Step 3：ThreadDetailPage 验证清单（逐条手动操作）**

1. 打开一个脉络 → 点「···」菜单 → 点「编辑关联记录」→ 进入编辑模式
2. 编辑模式下搜索框下方有 FilterBar（情绪/类型，无日期 chip）
3. 点「情绪 ▾」选情绪 → 未关联记录列表按情绪筛选，已关联记录（上方）不受影响
4. 输入文字同时有情绪筛选 → AND 逻辑，结果进一步缩小
5. 已关联的记录不出现在筛选结果中（排除逻辑正常）
6. 点 FilterBar 里的 ✕ 清除筛选 → 恢复默认分页列表
7. 点「完成」→ 退出编辑模式，FilterBar 状态清空

- [ ] **Step 4：确认 build 通过后提交**

```bash
npm run build
```

验证用户确认「没问题」后再执行提交：

```bash
git add src/components/FilterBar.jsx src/pages/RecordsPage.jsx src/pages/ThreadDetailPage.jsx
git commit -m "feat: add global search + filter bar (FilterBar, RecordsPage, ThreadDetailPage)"
```
