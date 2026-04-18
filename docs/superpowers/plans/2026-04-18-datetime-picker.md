# 写作页日期时间选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写作页模板栏右侧显示日期时间 pill，支持关键词自动识别 + 手动 picker 修改，保存时写入 created_at；RecordDetail 左上角时间戳改为可点击编辑。

**Architecture:** 新增 `src/lib/dateUtils.js`（纯函数 inferDatetime）、`src/components/DatetimePicker.jsx`（共用 picker sheet）；修改 HomePage.jsx（pill + debounce + draft 持久化）和 RecordDetail.jsx（可点击时间戳）。

**Tech Stack:** React state, localStorage, Supabase updateEntry（直接 UPDATE created_at，无需 RPC）

---

## 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `src/lib/dateUtils.js` | inferDatetime 纯函数 |
| 新建 | `src/components/DatetimePicker.jsx` | 共用 picker sheet 组件 |
| 修改 | `src/pages/HomePage.jsx` | 模板栏加 pill，debounce，draft 存 selectedDatetime |
| 修改 | `src/components/RecordDetail.jsx` | 时间戳改为可点击，调 DatetimePicker |

---

## Task 0：新建 `src/lib/dateUtils.js`

**Files:**
- Create: `src/lib/dateUtils.js`

### 功能

`inferDatetime(text, now)` — 从文本关键词推算绝对时间。

- 输入：`text`（字符串）、`now`（Date 对象，默认 `new Date()`）
- 输出：`Date | null`（有匹配返回 Date，无匹配返回 null）
- 多关键词：换算成绝对 Date，过滤掉 > now 的，取最近的（最大时间戳）

### 识别规则

| 关键词 | 日期偏移 | 时间 |
|---|---|---|
| 现在 / 刚刚 | ±0 | new Date()（当前时刻） |
| 今早 / 今晨 / 早上 / 上午 | ±0 | 09:00 |
| 中午 | ±0 | 12:00 |
| 下午 | ±0 | 16:00 |
| 傍晚 | ±0 | 18:00 |
| 晚上 / 夜里 / 今晚 | ±0 | 21:00 |
| 昨天 | -1 | 不变（保持 now 的时分） |
| 昨晚 / 昨夜 | -1 | 21:00 |
| 前天 | -2 | 不变 |
| 大前天 | -3 | 不变 |

- [ ] **Step 1：创建 `src/lib/dateUtils.js`**

```js
/**
 * inferDatetime(text, now)
 * 从文本关键词推算绝对时间。
 * 多关键词：过滤未来时间点，取最近（最大时间戳）的结果。
 * 无匹配返回 null。
 */
export function inferDatetime(text, now = new Date()) {
  const candidates = []

  function makeDate(dayOffset, hour, minute) {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    if (hour !== null) {
      d.setHours(hour, minute ?? 0, 0, 0)
    }
    return d
  }

  // 当前时刻
  if (/现在|刚刚/.test(text)) candidates.push(new Date(now))

  // 今天时段
  if (/今早|今晨|早上|上午/.test(text)) candidates.push(makeDate(0, 9, 0))
  if (/中午/.test(text))                candidates.push(makeDate(0, 12, 0))
  if (/下午/.test(text))                candidates.push(makeDate(0, 16, 0))
  if (/傍晚/.test(text))                candidates.push(makeDate(0, 18, 0))
  if (/晚上|夜里|今晚/.test(text))       candidates.push(makeDate(0, 21, 0))

  // 昨天（含时段）
  if (/昨晚|昨夜/.test(text))           candidates.push(makeDate(-1, 21, 0))
  else if (/昨天/.test(text))           candidates.push(makeDate(-1, null, null))

  // 前天 / 大前天
  if (/大前天/.test(text))              candidates.push(makeDate(-3, null, null))
  else if (/前天/.test(text))           candidates.push(makeDate(-2, null, null))

  if (candidates.length === 0) return null

  // 过滤未来时间点，取最近（最大时间戳）
  const valid = candidates.filter(d => d <= now)
  if (valid.length === 0) return null
  return new Date(Math.max(...valid.map(d => d.getTime())))
}

/**
 * formatPill(date, now)
 * 将 Date 格式化为 pill 显示文字。
 * 今天：「今天 HH:MM」
 * 其他：「M月D日 HH:MM」
 */
export function formatPill(date, now = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return `今天 ${hh}:${mm}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`
}
```

- [ ] **Step 2：验证文件可解析（无语法错误）**

```bash
node --input-type=module < src/lib/dateUtils.js && echo OK
```

预期：打印 `OK`，无报错。

- [ ] **Step 3：Commit**

```bash
git add src/lib/dateUtils.js
git commit -m "feat: add dateUtils.js — inferDatetime + formatPill"
```

---

## Task 1：新建 `src/components/DatetimePicker.jsx`

**Files:**
- Create: `src/components/DatetimePicker.jsx`

### Props

| Prop | 类型 | 说明 |
|---|---|---|
| `initialDatetime` | Date | 初始选中时间 |
| `onConfirm` | `(date: Date) => void` | 用户点「确认」回调 |
| `onClose` | `() => void` | 点背景关闭（不保存） |

### 内部状态

- `selectedDate`：当前选中的日期（Date 对象，只取年月日）
- `timeStr`：时间字符串，格式 `HH:MM`
- `calMonth`：日历展示的年月 `{ year, month }`（month 为 0-indexed）

### UI 结构

```
drag handle
「记录时间」标题
[今天] [昨天] [前天] [大前天]（快捷按钮）
‹ 2026年 4月 ›（迷你日历，含星期行 + 日期格）
时间  [HH:MM 输入框]
[确认按钮]
```

- [ ] **Step 1：创建 `src/components/DatetimePicker.jsx`**

```jsx
import { useState } from 'react'

const QUICK = [
  { label: '今天', offset: 0 },
  { label: '昨天', offset: -1 },
  { label: '前天', offset: -2 },
  { label: '大前天', offset: -3 },
]
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function dateOffset(now, offset) {
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

export default function DatetimePicker({ initialDatetime, onConfirm, onClose }) {
  const now = new Date()
  const init = initialDatetime instanceof Date ? initialDatetime : new Date()

  const [selectedDate, setSelectedDate] = useState(init)
  const [timeStr, setTimeStr] = useState(
    `${String(init.getHours()).padStart(2, '0')}:${String(init.getMinutes()).padStart(2, '0')}`
  )
  const [calMonth, setCalMonth] = useState({ year: init.getFullYear(), month: init.getMonth() })

  // ── 快捷按钮 ──
  function handleQuick(offset) {
    const d = dateOffset(now, offset)
    setSelectedDate(d)
    setCalMonth({ year: d.getFullYear(), month: d.getMonth() })
  }

  // ── 日历翻月 ──
  function prevMonth() {
    setCalMonth(c => {
      if (c.month === 0) return { year: c.year - 1, month: 11 }
      return { year: c.year, month: c.month - 1 }
    })
  }
  function nextMonth() {
    setCalMonth(c => {
      if (c.month === 11) return { year: c.year + 1, month: 0 }
      return { year: c.year, month: c.month + 1 }
    })
  }

  // ── 日历格 ──
  function buildCalDays() {
    const { year, month } = calMonth
    const firstDay = new Date(year, month, 1).getDay() // 0=日
    // 转为周一为第一列（0=一 … 6=日）
    const startOffset = firstDay === 0 ? 6 : firstDay - 1
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < startOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    return cells
  }

  // ── 时间输入失焦校验 ──
  function handleTimeBlur() {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (!match) {
      // 重置为初始值
      setTimeStr(
        `${String(init.getHours()).padStart(2, '0')}:${String(init.getMinutes()).padStart(2, '0')}`
      )
      return
    }
    const h = parseInt(match[1])
    const m = parseInt(match[2])
    if (h > 23 || m > 59) {
      setTimeStr(
        `${String(init.getHours()).padStart(2, '0')}:${String(init.getMinutes()).padStart(2, '0')}`
      )
      return
    }
    setTimeStr(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  // ── 确认 ──
  function handleConfirm() {
    const [h, m] = timeStr.split(':').map(Number)
    const result = new Date(selectedDate)
    result.setHours(h, m, 0, 0)
    onConfirm(result)
  }

  // ── 快捷按钮是否高亮 ──
  function isQuickSelected(offset) {
    return isSameDay(selectedDate, dateOffset(now, offset))
  }

  const calDays = buildCalDays()

  return (
    <>
      {/* 背景遮罩，点击关闭 */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.18)' }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'white', borderRadius: '16px 16px 0 0',
        padding: '16px 16px 32px',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.1)',
      }}>
        {/* drag handle */}
        <div style={{ width: 36, height: 3, background: '#e5e7eb', borderRadius: 99, margin: '0 auto 16px' }} />

        {/* 标题 */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 14 }}>记录时间</div>

        {/* 快捷按钮 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {QUICK.map(q => (
            <button
              key={q.label}
              onClick={() => handleQuick(q.offset)}
              style={{
                padding: '5px 12px', borderRadius: 99, fontSize: 12,
                border: `1px solid ${isQuickSelected(q.offset) ? '#c9a96e' : '#e5e7eb'}`,
                background: isQuickSelected(q.offset) ? '#c9a96e' : 'none',
                color: isQuickSelected(q.offset) ? 'white' : '#555',
                cursor: 'pointer',
              }}
            >{q.label}</button>
          ))}
        </div>

        {/* 迷你日历 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 8 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', fontSize: 14, color: '#aaa', cursor: 'pointer', padding: '2px 6px' }}>‹</button>
            <span>{calMonth.year}年 {calMonth.month + 1}月</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', fontSize: 14, color: '#aaa', cursor: 'pointer', padding: '2px 6px' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {WEEK_LABELS.map(l => (
              <div key={l} style={{ fontSize: 9, color: '#ccc', textAlign: 'center', padding: '2px 0' }}>{l}</div>
            ))}
            {calDays.map((d, i) => {
              if (!d) return <div key={`e${i}`} />
              const isSelected = isSameDay(d, selectedDate)
              const isToday = isSameDay(d, now)
              return (
                <div
                  key={d.toISOString()}
                  onClick={() => { setSelectedDate(d); setCalMonth({ year: d.getFullYear(), month: d.getMonth() }) }}
                  style={{
                    fontSize: 11, textAlign: 'center', padding: '4px 2px',
                    borderRadius: isSelected ? '50%' : 6,
                    background: isSelected ? '#c9a96e' : 'none',
                    color: isSelected ? 'white' : isToday ? '#c9a96e' : '#555',
                    fontWeight: isToday && !isSelected ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >{d.getDate()}</div>
              )
            })}
          </div>
        </div>

        {/* 时间输入 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>时间</span>
          <input
            type="text"
            value={timeStr}
            onChange={e => setTimeStr(e.target.value)}
            onBlur={handleTimeBlur}
            style={{
              flex: 1, maxWidth: 90, padding: '7px 10px',
              border: '1px solid #e5e7eb', borderRadius: 8,
              fontSize: 14, textAlign: 'center', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: 12, color: '#bbb' }}>可直接编辑</span>
        </div>

        {/* 确认按钮 */}
        <button
          onClick={handleConfirm}
          style={{
            width: '100%', padding: 10, borderRadius: 10, border: 'none',
            background: '#c9a96e', color: 'white', fontSize: 14,
            cursor: 'pointer', marginTop: 12,
          }}
        >确认</button>
      </div>
    </>
  )
}
```

- [ ] **Step 2：在 Vite dev server 中确认组件无编译报错**

```bash
npm run build 2>&1 | tail -5
```

预期：`built in Xs`，无 error。

- [ ] **Step 3：Commit**

```bash
git add src/components/DatetimePicker.jsx
git commit -m "feat: add DatetimePicker shared sheet component"
```

---

## Task 2：修改 `src/pages/HomePage.jsx` — 日期时间 pill

**Files:**
- Modify: `src/pages/HomePage.jsx`

### 变更点

1. 新增 import：`DatetimePicker`, `inferDatetime`, `formatPill`
2. 新增 state：`selectedDatetime`（Date）、`manualOverride`（boolean）、`showPicker`（boolean）
3. 扩展 `saveDraft` / `loadDraft`：存取 `selectedDatetime`（ISO 字符串）+ `manualOverride`
4. 新增 debounce effect：内容变化 800ms 后调 `inferDatetime`，`!manualOverride` 时才更新 `selectedDatetime`
5. 模板栏右侧加 pill（仅新建模式，编辑模式不显示）
6. `handleDone` 和 `handleDeepAwareness` 里的 `created_at: new Date().toISOString()` 改为 `selectedDatetime.toISOString()`

- [ ] **Step 1：在文件顶部 import 新增三项**

在 `src/pages/HomePage.jsx` 第 26 行（`import { seedDefaultCoreNeeds }`）之后追加：

```js
import DatetimePicker from '../components/DatetimePicker'
import { inferDatetime, formatPill } from '../lib/dateUtils'
```

- [ ] **Step 2：扩展 `saveDraft` 和 `loadDraft`**

将原来的 `saveDraft` 和 `loadDraft` 替换为：

```js
function saveDraft(content, templateId, selectedDatetime, manualOverride) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      content,
      template: templateId,
      savedAt: new Date().toISOString(),
      selectedDatetime: selectedDatetime instanceof Date ? selectedDatetime.toISOString() : null,
      manualOverride: Boolean(manualOverride),
    }))
  } catch (_) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (Date.now() - new Date(draft.savedAt).getTime() > 86400000) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    // 把 ISO 字符串还原为 Date
    if (draft.selectedDatetime) {
      draft.selectedDatetime = new Date(draft.selectedDatetime)
    }
    return draft
  } catch (_) {
    return null
  }
}
```

- [ ] **Step 3：在 `HomePage` 组件内新增三个 state（加在 `saving` state 后面，约第 109 行）**

```js
// 日期时间选择
const [selectedDatetime, setSelectedDatetime] = useState(() => new Date())
const [manualOverride, setManualOverride] = useState(false)
const [showPicker, setShowPicker] = useState(false)
const inferTimerRef = useRef(null)
```

- [ ] **Step 4：修改草稿恢复逻辑，还原 selectedDatetime + manualOverride**

将原来的 `handleResumeDraft`（约第 170 行）替换为：

```js
const handleResumeDraft = () => {
  if (draftRef.current) {
    setContent(draftRef.current.content)
    const t = resolveTemplate(draftRef.current.template)
    setTemplate(t)
    if (draftRef.current.selectedDatetime) {
      setSelectedDatetime(draftRef.current.selectedDatetime)
      setManualOverride(draftRef.current.manualOverride ?? false)
    }
  }
  setShowDraftBanner(false)
}
```

- [ ] **Step 5：修改自动保存草稿 effect，传入 selectedDatetime 和 manualOverride**

将原来的自动保存 effect（约第 155–162 行）替换为：

```js
useEffect(() => {
  if (isEditMode) return
  clearTimeout(draftTimerRef.current)
  draftTimerRef.current = setTimeout(() => {
    if (content.trim()) saveDraft(content, template.id, selectedDatetime, manualOverride)
  }, 3000)
  return () => clearTimeout(draftTimerRef.current)
}, [content, template.id, isEditMode, selectedDatetime, manualOverride])
```

- [ ] **Step 6：新增 inferDatetime debounce effect（加在自动保存 effect 之后）**

```js
// ── inferDatetime debounce（仅新建模式）──────────────────────────
useEffect(() => {
  if (isEditMode) return
  clearTimeout(inferTimerRef.current)
  inferTimerRef.current = setTimeout(() => {
    if (manualOverride) return
    const result = inferDatetime(content)
    if (result) setSelectedDatetime(result)
  }, 800)
  return () => clearTimeout(inferTimerRef.current)
}, [content, isEditMode, manualOverride])
```

- [ ] **Step 7：模板栏右侧加 datetime pill（仅新建模式）**

找到模板标签栏 `<div className="flex items-center gap-0.5 px-[18px] pt-3">` 区块，
在编辑模式取消按钮的 `{isEditMode && onCancel && (...)}` 之后（约第 406–414 行）加入：

```jsx
{/* 日期时间 pill（仅新建模式） */}
{!isEditMode && (
  <button
    onClick={() => setShowPicker(true)}
    style={{
      marginLeft: 'auto',
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 99,
      border: `1px solid ${manualOverride || !isSameDatetime(selectedDatetime, new Date()) ? '#f0e4cc' : 'transparent'}`,
      background: manualOverride || !isSameDatetime(selectedDatetime, new Date()) ? '#fdf6ec' : 'none',
      color: manualOverride || !isSameDatetime(selectedDatetime, new Date()) ? '#c9a96e' : '#bbb',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }}
  >
    {formatPill(selectedDatetime)}
  </button>
)}
```

并在组件内（state 区块附近）定义辅助函数：

```js
function isSameDatetime(a, b) {
  // 精确到分钟：相差 < 60s 视为相同（默认状态）
  return Math.abs(a.getTime() - b.getTime()) < 60000
}
```

- [ ] **Step 8：在模板栏外侧（return 最顶层 div 内、草稿 banner 之前）插入 DatetimePicker**

```jsx
{/* 日期时间 picker sheet */}
{showPicker && (
  <DatetimePicker
    initialDatetime={selectedDatetime}
    onConfirm={(d) => {
      setSelectedDatetime(d)
      setManualOverride(true)
      setShowPicker(false)
    }}
    onClose={() => setShowPicker(false)}
  />
)}
```

- [ ] **Step 9：修改 `handleDone` 里的 `created_at`（约第 293 行）**

将：
```js
created_at: new Date().toISOString(),
```
改为：
```js
created_at: selectedDatetime.toISOString(),
```

- [ ] **Step 10：修改 `handleDeepAwareness` 里的 `created_at`（约第 316 行）**

将：
```js
created_at: new Date().toISOString(),
```
改为：
```js
created_at: selectedDatetime.toISOString(),
```

- [ ] **Step 11：运行 build 确认无编译报错**

```bash
npm run build 2>&1 | tail -5
```

预期：`built in Xs`，无 error。

- [ ] **Step 12：手动验证**

1. 打开写作页，模板栏右侧有灰色「今天 HH:MM」文字
2. 输入「昨晚」停顿 1 秒 → pill 变金色，显示「昨天 21:00」
3. 点 pill → DatetimePicker sheet 弹出
4. 选快捷「前天」→ 日历同步高亮 → 点确认 → pill 显示「M月D日 HH:MM」
5. 再输入「今早」→ pill 不变（manualOverride = true）
6. 编辑模式进入 → pill 不显示

- [ ] **Step 13：Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: add datetime pill + inferDatetime to HomePage"
```

---

## Task 3：修改 `src/components/RecordDetail.jsx` — 可点击时间戳

**Files:**
- Modify: `src/components/RecordDetail.jsx`

### 变更点

1. 新增 import：`DatetimePicker`
2. 新增 state：`showDatetimePicker`（boolean）
3. 第 540 行的 `<span>` 改为 `<button>`，加 `cursor: pointer` 和 `onClick`
4. 在 JSX 顶部插入 `DatetimePicker`，`onConfirm` 时调 `updateEntry` 写 DB 并本地刷新 entry

- [ ] **Step 1：在文件顶部（约第 12 行）追加 import**

在 `import { loadCoreNeeds, addCoreNeed } from '../lib/coreNeedsService'` 之后加：

```js
import DatetimePicker from './DatetimePicker'
```

- [ ] **Step 2：在 `RecordDetail` 组件内新增 state**

找到组件内第一批 `useState` 声明，加入：

```js
const [showDatetimePicker, setShowDatetimePicker] = useState(false)
```

- [ ] **Step 3：将时间戳 `<span>` 改为可点击 `<button>`**

将第 540 行：

```jsx
<span style={{ fontSize: 12, color: '#bbb' }}>{formatDateTime(entry.created_at)}</span>
```

替换为：

```jsx
<button
  onClick={() => setShowDatetimePicker(true)}
  style={{
    fontSize: 12, color: '#bbb', background: 'none',
    border: 'none', padding: 0, cursor: 'pointer',
  }}
  onMouseEnter={e => e.currentTarget.style.color = '#999'}
  onMouseLeave={e => e.currentTarget.style.color = '#bbb'}
>
  {formatDateTime(entry.created_at)}
</button>
```

- [ ] **Step 4：在组件 JSX 最顶层（return 的根 div 内最开始）插入 DatetimePicker**

在根 `<div>` 内最开始加：

```jsx
{/* 日期时间 picker sheet */}
{showDatetimePicker && (
  <DatetimePicker
    initialDatetime={new Date(entry.created_at)}
    onConfirm={async (d) => {
      const iso = d.toISOString()
      setShowDatetimePicker(false)
      setEntry(e => ({ ...e, created_at: iso }))
      await updateEntry({ id: entry.id, userId: user.id, fields: { created_at: iso } })
    }}
    onClose={() => setShowDatetimePicker(false)}
  />
)}
```

- [ ] **Step 5：运行 build 确认无编译报错**

```bash
npm run build 2>&1 | tail -5
```

预期：`built in Xs`，无 error。

- [ ] **Step 6：手动验证**

1. 进入任意一条记录的详情页
2. 点击左上角时间戳（如「4月18日 14:32」）→ picker sheet 弹出，初始值 = 该记录时间
3. 选快捷「昨天」→ 日历联动 → 改时间为「20:00」→ 点确认
4. 详情页时间戳立即刷新为「昨天 20:00」对应格式
5. 返回列表再进该记录 → 时间戳已持久化（DB 已更新）

- [ ] **Step 7：Commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: make RecordDetail timestamp clickable, edit via DatetimePicker"
```

---

## Task 4：整体验收

**对照 spec §6 成功标准逐条验证**

- [ ] **1.** 写作页模板栏右侧有灰色时间文字，无 emoji
- [ ] **2.** 输入「昨晚跟妈妈」→ 停顿 1 秒 → pill 变金色显示「昨天 21:00」
- [ ] **3.** 多关键词：「今早」+「昨晚」，当前时刻中午 → pill 显示「今天 09:00」（今早 09:00 > 昨晚，取最近）
- [ ] **4.** 手动点 pill → picker sheet 弹出，快捷按钮 / 日历 / 时间框联动正常
- [ ] **5.** 手动确认后 pill 变金色，之后继续输入「昨天」→ pill 不变（manualOverride = true）
- [ ] **6.** 保存后进入记录详情，created_at 为用户选择的时间（不是保存时刻）
- [ ] **7.** RecordDetail 左上角时间戳可点击 → picker sheet → 确认后 DB 更新，显示刷新
- [ ] **8.** 编辑模式（editEntry）进入 HomePage 时，不显示日期 pill

- [ ] **全部通过后，最终 Commit（如有剩余未提交文件）**

```bash
git status
git add -p   # 逐块确认
git commit -m "feat: datetime picker complete"
```
