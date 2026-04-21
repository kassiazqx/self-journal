# Bug 修复批次：人物识别 + 回顾信设置 + 时间编辑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 5 个独立 Bug：人物子串误匹配、dismiss 状态不持久化、回顾信设置切页重置、触发方式改为自定义数字、EditEntryPage 新增时间编辑。

**Architecture:** 全部改动限定在已有文件内，无新文件、无新表、无 API 变更。最大改动是 `detectPeopleFromText` 算法从简单 `includes` 改为长度优先 + 区间消耗，其余均为状态持久化和 UI 补全。

**Tech Stack:** React useState/useEffect、localStorage、Supabase `updateEntry`

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/contactsService.js` | `detectPeopleFromText` 改为长度优先匹配，防子串误命中 |
| `src/pages/HomePage.jsx` | `saveDraft`/`loadDraft`/`handleResumeDraft` 加入 `dismissedPeople` 字段 |
| `src/lib/reviewLetterService.js` | export `getUserLetterPrefs` |
| `src/pages/SettingsPage.jsx` | mount 时加载 letterPrefs；触发方式 UI 改为数字输入 + 手动 |
| `src/pages/EditEntryPage.jsx` | 新增 DatetimePicker，保存时写入 `created_at` |

---

## Task 1：修复 `detectPeopleFromText` 子串误匹配

**Files:**
- Modify: `src/lib/contactsService.js:106-116`

**问题：** `text.includes('朋友')` 在文本含「男朋友」时也返回 true，导致两个都被识别。

**修法：** 按关键词长度降序排，长词先匹配并标记消耗区间，短词不得与已消耗区间重叠。

- [ ] **Step 1：替换 `detectPeopleFromText` 函数**

找到 `src/lib/contactsService.js` 第 106 行，将整个函数替换为：

```js
export function detectPeopleFromText(text, contacts) {
  if (!text || !contacts?.length) return []

  // 把所有 (canonical, keyword) 对收集起来，按关键词长度降序排
  // 长词优先命中，防止「朋友」被「男朋友」的子串误匹配
  const pairs = []
  for (const contact of contacts) {
    const allKeywords = [contact.canonical, ...(contact.aliases || [])]
    for (const kw of allKeywords) {
      if (kw) pairs.push({ canonical: contact.canonical, kw })
    }
  }
  pairs.sort((a, b) => b.kw.length - a.kw.length)

  const matched = new Set()
  const usedRanges = []  // 已消耗的文本区间 [start, end)

  for (const { canonical, kw } of pairs) {
    if (matched.has(canonical)) continue  // 该联系人已通过其他关键词命中，跳过

    let idx = text.indexOf(kw)
    while (idx !== -1) {
      const end = idx + kw.length
      const overlaps = usedRanges.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        usedRanges.push([idx, end])
        matched.add(canonical)
        break
      }
      idx = text.indexOf(kw, idx + 1)
    }
  }

  return [...matched]
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：手动验证逻辑**

在浏览器控制台或本地运行：
```js
// 伪造场景：contacts 含「朋友」和「男朋友」
const contacts = [
  { canonical: '男朋友', aliases: [] },
  { canonical: '朋友', aliases: [] },
]
detectPeopleFromText('我男朋友今天很好', contacts)
// 期望：['男朋友']（不应包含「朋友」）

detectPeopleFromText('我朋友来了', contacts)
// 期望：['朋友']

detectPeopleFromText('我朋友和我男朋友都来了', contacts)
// 期望：['男朋友', '朋友']（两处不重叠，都应识别）
```

- [ ] **Step 4：Commit**

```bash
git add src/lib/contactsService.js
git commit -m "fix: detectPeopleFromText 改为长度优先匹配，防子串误命中（男朋友/朋友）"
```

---

## Task 2：`dismissedPeople` 持久化到草稿 localStorage

**Files:**
- Modify: `src/pages/HomePage.jsx`（`saveDraft`/`loadDraft`/`handleResumeDraft` + autosave effect）

**问题：** 用户点 ✕ 关掉某人的 chip，`dismissedPeople` 只在 React state 里，切到觉察卡再回来后 state 重置，已关掉的人重新出现。

- [ ] **Step 1：修改 `saveDraft` 函数（第 49 行）加入 dismissedPeople 参数**

找到：
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
```

替换为：
```js
function saveDraft(content, templateId, selectedDatetime, manualOverride, dismissedPeople) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      content,
      template: templateId,
      savedAt: new Date().toISOString(),
      selectedDatetime: selectedDatetime instanceof Date ? selectedDatetime.toISOString() : null,
      manualOverride: Boolean(manualOverride),
      dismissedPeople: dismissedPeople ? [...dismissedPeople] : [],
    }))
  } catch (_) {}
}
```

- [ ] **Step 2：修改 `loadDraft` 函数（第 61 行）还原 dismissedPeople**

找到 `loadDraft` 函数内 `return draft` 之前，在 `if (draft.selectedDatetime)` 块之后加一行：

```js
    // 还原 dismissedPeople 数组为 Set
    draft.dismissedPeople = new Set(draft.dismissedPeople ?? [])
```

完整 loadDraft 改后：
```js
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (Date.now() - new Date(draft.savedAt).getTime() > 86400000) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    if (draft.selectedDatetime) {
      draft.selectedDatetime = new Date(draft.selectedDatetime)
    }
    draft.dismissedPeople = new Set(draft.dismissedPeople ?? [])
    return draft
  } catch (_) {
    return null
  }
}
```

- [ ] **Step 3：在 `handleResumeDraft`（第 294 行）恢复 dismissedPeople**

找到 `handleResumeDraft` 函数，在 `setShowDraftBanner(false)` 之前加一行：

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
      if (draftRef.current.dismissedPeople?.size > 0) {
        setDismissedPeople(draftRef.current.dismissedPeople)
      }
    }
    setShowDraftBanner(false)
  }
```

- [ ] **Step 4：在 autosave useEffect（约第 265 行）传入 dismissedPeople**

找到：
```js
      if (content.trim()) saveDraft(content, template.id, selectedDatetime, manualOverride)
```

替换为：
```js
      if (content.trim()) saveDraft(content, template.id, selectedDatetime, manualOverride, dismissedPeople)
```

同时把 `dismissedPeople` 加入 useEffect 的依赖数组（找到 `}, [content, template.id, isEditMode, selectedDatetime, manualOverride]` 这一行）：

```js
  }, [content, template.id, isEditMode, selectedDatetime, manualOverride, dismissedPeople])
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6：Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "fix: dismissedPeople 持久化到草稿，退回后已关掉的人不再重现"
```

---

## Task 3：回顾信设置切页重置修复

**Files:**
- Modify: `src/lib/reviewLetterService.js`（export `getUserLetterPrefs`）
- Modify: `src/pages/SettingsPage.jsx`（mount 时加载 prefs）

**问题：** `getUserLetterPrefs` 未 export，SettingsPage 的 `letterPrefs` state 每次 mount 都用写死的默认值初始化，已保存的设置从未被读取。

- [ ] **Step 1：在 reviewLetterService.js 里 export getUserLetterPrefs**

找到第 10 行：
```js
async function getUserLetterPrefs(userId) {
```

改为：
```js
export async function getUserLetterPrefs(userId) {
```

- [ ] **Step 2：在 SettingsPage.jsx 的 import 行引入 getUserLetterPrefs**

找到第 7 行：
```js
import { generateLetterNow, saveUserLetterPrefs } from '../lib/reviewLetterService'
```

改为：
```js
import { generateLetterNow, saveUserLetterPrefs, getUserLetterPrefs } from '../lib/reviewLetterService'
```

- [ ] **Step 3：在 SettingsPage 的 useEffect（第 77 行）里加载 letterPrefs**

找到：
```js
  useEffect(() => {
    if (!user) return
    loadTagOptions()
  }, [user])
```

改为：
```js
  useEffect(() => {
    if (!user) return
    loadTagOptions()
    getUserLetterPrefs(user.id).then(prefs => {
      if (prefs) setLetterPrefs(prefs)
    }).catch(() => {})
  }, [user])
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5：Commit**

```bash
git add src/lib/reviewLetterService.js src/pages/SettingsPage.jsx
git commit -m "fix: 回顾信设置切页重置——export getUserLetterPrefs + mount 时加载"
```

---

## Task 4：触发方式改为自定义数字输入 + 手动

**Files:**
- Modify: `src/pages/SettingsPage.jsx:512-535`

**改动：** 把原来的 3 个 radio（7天/10条/手动）替换为：数字输入框（3~50，默认 10）+ 手动生成 radio。去掉「每隔 N 天」选项（使用极少，简化交互）。

- [ ] **Step 1：替换触发方式 UI 区域**

找到第 512-535 行整段：
```jsx
          {[
            { value: 'days',   label: `每隔 ${letterPrefs.day_interval} 天自动生成` },
            { value: 'count',  label: `累积 ${letterPrefs.count_threshold} 条情感记录后生成` },
            { value: 'manual', label: '手动生成' },
          ].map(opt => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, color: '#333', marginBottom: 12, cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="letterTrigger"
                value={opt.value}
                checked={letterPrefs.type === opt.value}
                onChange={() => {
                  const updated = { ...letterPrefs, type: opt.value }
                  setLetterPrefs(updated)
                  saveUserLetterPrefs(user.id, updated, () => {})
                }}
              />
              {opt.label}
            </label>
          ))}
```

替换为：
```jsx
          {/* 选项 A：累积 N 条后自动生成 */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, color: '#333', marginBottom: 14, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="letterTrigger"
              checked={letterPrefs.type === 'count'}
              onChange={() => {
                const updated = { ...letterPrefs, type: 'count' }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
            />
            累积
            <input
              type="number"
              min={3}
              max={50}
              value={letterPrefs.count_threshold}
              disabled={letterPrefs.type !== 'count'}
              onChange={e => {
                const n = Math.max(3, Math.min(50, parseInt(e.target.value) || 10))
                const updated = { ...letterPrefs, count_threshold: n }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
              style={{
                width: 48, textAlign: 'center', fontSize: 14,
                border: '1px solid #e0dbd4', borderRadius: 6,
                padding: '2px 4px', background: letterPrefs.type === 'count' ? 'white' : '#f5f3ef',
                color: letterPrefs.type === 'count' ? '#333' : '#bbb',
              }}
            />
            条情感记录后自动生成
          </label>

          {/* 选项 B：手动生成 */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, color: '#333', marginBottom: 14, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="letterTrigger"
              checked={letterPrefs.type === 'manual'}
              onChange={() => {
                const updated = { ...letterPrefs, type: 'manual' }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
            />
            手动生成（不自动触发）
          </label>
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3：Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: 回顾信触发方式改为自定义数字输入 + 手动两选项"
```

---

## Task 5：EditEntryPage 新增时间编辑

**Files:**
- Modify: `src/pages/EditEntryPage.jsx`

**问题：** 用户进入觉察卡后想退回改记录时间，但 EditEntryPage 没有时间编辑入口。

- [ ] **Step 1：在 import 区引入 DatetimePicker 和 formatPill**

找到第 9 行 import 区末尾，新增：
```js
import DatetimePicker from '../components/DatetimePicker'
import { formatPill } from '../lib/dateUtils'
```

- [ ] **Step 2：在 EditEntryPage 函数体内新增 datetime state（第 42 行附近，现有 state 之后）**

找到 `const [saving, setSaving] = useState(false)` 之后插入：
```js
  const [editDatetime, setEditDatetime] = useState(new Date(entry.created_at ?? Date.now()))
  const [showPicker, setShowPicker] = useState(false)
```

- [ ] **Step 3：在 `handleSave`（第 122 行）的 `fields` 里加入 `created_at`**

找到第 132 行：
```js
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } })
```

改为：
```js
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } })
```

找到第 141 行（有 flow 的分支）：
```js
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } }),
```

改为：
```js
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } }),
```

- [ ] **Step 4：在 JSX 里渲染 DatetimePicker 弹出层 + 时间 pill**

找到 EditEntryPage 的 return 语句最外层 div 的开头，在其内部第一个子元素之前插入（DatetimePicker sheet）：

```jsx
      {/* 时间编辑 picker */}
      {showPicker && (
        <DatetimePicker
          initialDatetime={editDatetime}
          onConfirm={d => { setEditDatetime(d); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
```

然后找到 EditEntryPage 顶部导航栏（含「取消」按钮的 header div），在「取消」按钮旁边右侧加时间 pill。

先找顶部导航栏 —— grep 结果里没有明确行号，先找「取消」按钮：

```bash
grep -n "取消\|onBack" src/pages/EditEntryPage.jsx
```

在找到的顶栏 div 里，在「取消」按钮同一行加上右侧的时间 pill：

顶栏结构改为（保持现有「取消」按钮不变，右侧新增时间按钮）：

找到顶栏 div 里最外层 `justifyContent: 'space-between'` 的容器，加第三个元素（时间 pill）：

```jsx
          <button
            onClick={() => setShowPicker(true)}
            style={{
              background: 'none', border: '1px solid #f0e4cc',
              borderRadius: 99, fontSize: 11,
              padding: '2px 8px', color: '#c9a96e', cursor: 'pointer',
            }}
          >
            {formatPill(editDatetime)}
          </button>
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6：Commit**

```bash
git add src/pages/EditEntryPage.jsx
git commit -m "feat: EditEntryPage 新增时间编辑，保存时更新 created_at"
```

---

## Task 6：本地验收

```bash
npm run dev
```

**验收清单：**

1. 写「我男朋友今天…」→ 底部只出现「男朋友」chip，不出现「朋友」
2. 关掉某人 chip → 进觉察卡再退回 → 该人不再出现
3. 设置页选「手动生成」→ 切到记录页再回来 → 依然显示「手动生成」
4. 设置页数字框改为 5 → 切页回来 → 显示 5 而非 10
5. EditEntryPage 顶栏有时间 pill → 点击弹出时间选择器 → 确认后时间更新 → 保存后记录时间变更
