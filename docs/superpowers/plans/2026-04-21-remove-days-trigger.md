# 删除「间隔 N 天」触发逻辑死代码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底删除回顾信「按天触发」(`type: 'days'`) 的死代码，同时对旧存储里残留的 `type: 'days'` 做向下兼容处理，保证 `checkAndGenerateLetter` 不静默失效。

**Architecture:** UI 已在上一批次删除（Task 4），本批只改服务层和 state 初始值。在 `getUserLetterPrefs` 的三个 return 点统一 normalize，确保所有调用方（SettingsPage + checkAndGenerateLetter）都拿到合法值，不需要调用方各自处理。

**Tech Stack:** React useState，纯 JS 逻辑删除，无 DB/API 变更。

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/reviewLetterService.js` | `getUserLetterPrefs` 三个 return 点加 `days→count` normalize；默认值删 `day_interval: 7`；`checkAndGenerateLetter` 删 `daysSinceLast` + 简化 `shouldGenerate` |
| `src/pages/SettingsPage.jsx` | state 初始值删 `day_interval: 7` |

---

## Task 1：`reviewLetterService.js` 清理

**Files:**
- Modify: `src/lib/reviewLetterService.js:10-26` 和 `src/lib/reviewLetterService.js:202-218`

- [ ] **Step 1：替换 `getUserLetterPrefs` 函数（第10-26行）**

找到：
```js
async function getUserLetterPrefs(userId) {
  // 主存储：user_memory（多端同步）
  try {
    const memory = await getMemory(userId)
    const prefs = memory?.user_profile?.letter_prefs
    if (prefs) return prefs
  } catch { /* ignore */ }

  // 降级：localStorage
  try {
    const stored = localStorage.getItem(`letter_prefs_${userId}`)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }

  // 默认：每写 10 条自动触发
  return { type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true }
}
```

替换为：
```js
async function getUserLetterPrefs(userId) {
  // 主存储：user_memory（多端同步）
  try {
    const memory = await getMemory(userId)
    const prefs = memory?.user_profile?.letter_prefs
    if (prefs) {
      // 兼容旧存储中 type: 'days'（已弃用），降级为 count
      return prefs.type === 'days' ? { ...prefs, type: 'count' } : prefs
    }
  } catch { /* ignore */ }

  // 降级：localStorage
  try {
    const stored = localStorage.getItem(`letter_prefs_${userId}`)
    if (stored) {
      const prefs = JSON.parse(stored)
      return prefs.type === 'days' ? { ...prefs, type: 'count' } : prefs
    }
  } catch { /* ignore */ }

  // 默认：每写 10 条自动触发
  return { type: 'count', count_threshold: 10, require_new_entries: true }
}
```

- [ ] **Step 2：在 `checkAndGenerateLetter` 里删除 `daysSinceLast` + 简化 `shouldGenerate`**

找到（约第202-218行）：
```js
  const lastDate = lastLetter?.created_at ? new Date(lastLetter.created_at) : null
  const daysSinceLast = lastDate
    ? (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate =
    (prefs.type === 'days'  && daysSinceLast >= prefs.day_interval) ||
    (prefs.type === 'count' && newEntryCount >= prefs.count_threshold)
```

替换为（删除 `lastDate` / `daysSinceLast` 三行，简化 `shouldGenerate`）：
```js
  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate = prefs.type === 'count' && newEntryCount >= prefs.count_threshold
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error，无 warning 提及 `daysSinceLast` 或 `day_interval`。

- [ ] **Step 4：Commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "refactor: 删除 days 触发死代码，getUserLetterPrefs 三点 normalize 兼容旧存储"
```

---

## Task 2：`SettingsPage.jsx` 清理 state 初始值

**Files:**
- Modify: `src/pages/SettingsPage.jsx:46-48`

- [ ] **Step 1：删除 state 初始值里的 `day_interval: 7`**

找到：
```js
  const [letterPrefs, setLetterPrefs] = useState({
    type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true,
  })
```

替换为：
```js
  const [letterPrefs, setLetterPrefs] = useState({
    type: 'count', count_threshold: 10, require_new_entries: true,
  })
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 3：Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "refactor: SettingsPage 初始值删除已弃用的 day_interval 字段"
```

---

## Task 3：本地验收

```bash
npm run dev
```

**验收清单：**

1. 打开设置页 → 回顾信区域只有两个选项（数字输入 + 手动），无「每隔 N 天」
2. 选「累积 N 条」→ 修改数字 → 切到记录页再回来 → 数字保持（Task 3 已修复，回归确认）
3. 浏览器控制台无 `daysSinceLast` / `day_interval` 相关报错
4. 手动触发 `generateLetterNow`（设置页按钮）→ 正常生成，无 JS 错误
