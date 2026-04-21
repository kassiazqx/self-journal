# 感恩进度点实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页【感恩】模板引导词下方显示 ●○○ 进度点，实时反映今日已写感恩条目数（最多填满 3 个）。

**Architecture:** 一处 lib 函数 + 一处页面改动。`journalService.js` 新增 `fetchTodayGratitudeCount(userId)` 做 DB 查询；`HomePage.jsx` 在 mount 时取数、以 state 驱动渲染。写完感恩日记后用户会跳出首页（感恩模板 `awarenessStart !== null`），返回时组件重新 mount 自动刷新计数，无需在 `handleDone` 里额外触发。

**Tech Stack:** React useState/useEffect，Supabase（通过 `src/lib/journalService.js` 访问）

**Spec:** `docs/superpowers/specs/2026-04-21-gratitude-progress-dots-design.md`

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/journalService.js` | 末尾新增 `fetchTodayGratitudeCount(userId)` |
| `src/pages/HomePage.jsx` | import 新函数；新增 `gratitudeCount` state；useEffect 取数；引导词下方渲染点 |

---

## Task 1：journalService.js — 新增 fetchTodayGratitudeCount

**Files:**
- Modify: `src/lib/journalService.js`

- [ ] **Step 1：在文件末尾追加函数**

```js
// ─── 今日感恩条目数 ──────────────────────────────────────────────
// 返回 { count: number, error }
// count 已 clamp 到最大 3（调用方直接用）
export async function fetchTodayGratitudeCount(userId) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('template_type', 'gratitude')
    .gte('created_at', todayStart.toISOString())

  return { count: Math.min(count ?? 0, 3), error }
}
```

> `head: true` 表示只取 count 不取行数据，最省流量。`supabase` 已在文件顶部 import，无需新增。

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/lib/journalService.js
git commit -m "feat: journalService 新增 fetchTodayGratitudeCount"
```

---

## Task 2：HomePage.jsx — 取数 + 渲染进度点

**Files:**
- Modify: `src/pages/HomePage.jsx`

### 背景

- 引导词区在第 697–723 行（`{/* ── 引导词行 ── */}` 注释起）
- 进度点插入在引导词 `</div>` 之后、输入区 `{/* ── 输入区 ── */}` 之前
- `HomePage.jsx` 顶部第 22 行已有 `import { insertEntry, updateEntry } from '../lib/journalService'`

- [ ] **Step 1：在 import 行加入 `fetchTodayGratitudeCount`**

找到第 22 行：
```js
import { insertEntry, updateEntry } from '../lib/journalService'
```

替换为：
```js
import { insertEntry, updateEntry, fetchTodayGratitudeCount } from '../lib/journalService'
```

- [ ] **Step 2：新增 `gratitudeCount` state**

在文件中找到其他 `useState` 声明的区域（约第 188 行附近），追加一行：

```js
  const [gratitudeCount, setGratitudeCount] = useState(0)
```

- [ ] **Step 3：新增 useEffect 在 mount 时取数**

在 `gratitudeCount` state 声明下方紧接着插入：

```js
  // 今日感恩条目计数（mount 时取一次，返回页面时因 re-mount 自动刷新）
  useEffect(() => {
    if (!user?.id) return
    fetchTodayGratitudeCount(user.id).then(({ count }) => setGratitudeCount(count))
  }, [user?.id])
```

- [ ] **Step 4：在引导词行下方插入进度点渲染**

找到引导词行结束处（第 723 行）：
```jsx
      </div>

      {/* ── 输入区（相对定位容器，供 @ 浮层定位）── */}
```

在这两个块之间插入：
```jsx
      {/* ── 感恩进度点（仅感恩模板）── */}
      {template.id === 'gratitude' && (
        <div style={{ paddingLeft: 27, paddingTop: 6, fontSize: 13, color: '#c9a96e', letterSpacing: '4px' }}>
          {'●'.repeat(gratitudeCount)}{'○'.repeat(3 - gratitudeCount)}
        </div>
      )}

```

> `paddingLeft: 27` = 页面 padding 18px + 竖线 1.5px + gap 8px，与引导文字左对齐。

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 6：Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: 首页感恩模板引导词下新增 ●○○ 进度点"
```

---

## Task 3：本地验收

```bash
npm run dev
```

**验收清单：**

1. 进入首页，选【感恩】标签，引导词下方出现 ○○○（假设今日未写）
2. 切换到其他模板（学习/情绪等），点消失
3. 写一条感恩日记保存，返回首页，显示 ●○○
4. 写满三条，显示 ●●●
5. 写第四条，点保持 ●●●，条目正常保存到记录页
6. 次日（或手动把 `todayStart` 改为未来时间测试），计数重置为 ○○○
