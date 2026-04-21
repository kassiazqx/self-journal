# 脉络详情页 AI 分析（碎片 + 此刻这里）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在脉络详情页新增「一些碎片」和「此刻这里」两个 AI 生成段落，替换现有 `arc_summary`（变化轨迹）区块。用户手动点击触发分析，结果存 DB。

**Architecture:** 三处改动。Supabase 手动加列；`threadService.js` 新增 `generateThreadAnalysis()`；`ThreadDetailPage.jsx` 替换 arc_summary 区块为新两段 UI，底部加「重新分析」按钮，原 ··· 菜单的「重新分析」改名为「查找新记录」以区分。

**Tech Stack:** React inline styles，Supabase，callAI

**Spec:** `docs/superpowers/specs/2026-04-21-thread-detail-analysis-design.md`

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| Supabase SQL（手动执行） | `threads` 表加 `fragments`、`current_state`、`analysis_generated_at` |
| `src/lib/threadService.js` | 新增 `generateThreadAnalysis(threadId, userId)` |
| `src/lib/prompts.js` | 新增 `buildThreadAnalysisPrompt(threadName, entries)` |
| `src/pages/ThreadDetailPage.jsx` | 替换 arc_summary 区块；加底部分析按钮；菜单项改名 |

---

## Task 0：Supabase DB 迁移（手动执行）

在 Supabase SQL Editor 执行：

```sql
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS fragments jsonb,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS analysis_generated_at timestamptz;
```

执行后在 Supabase Table Editor 确认三列已存在，无 error。

---

## Task 1：threadService.js + prompts.js — 新增 generateThreadAnalysis

**Files:**
- Modify: `src/lib/threadService.js`
- Modify: `src/lib/prompts.js`

### 背景

`generateThreadAnalysis` 需要完整 `content` 字段（用于引用原句），不能用现有 `fetchThreadWithEntries`（只选了 `entry_summary`）。需自己查询并过滤 `removed_by_user = false`。

- [ ] **Step 1：在 `src/lib/prompts.js` 末尾新增 `buildThreadAnalysisPrompt`**

```js
// ─── 脉络详情分析 prompt ─────────────────────────────────────────
// entries: [{ date: 'YYYY/MM/DD', content: string }]（全文，已过滤 removed_by_user）
export function buildThreadAnalysisPrompt(threadName, entries) {
  const entryCount = entries.length
  const dates = entries.map(e => e.date).sort()
  const dateRange = `${dates[0]}—${dates[dates.length - 1]}`

  const entriesText = entries
    .map(e => `[${e.date}]\n${e.content}`)
    .join('\n\n---\n\n')

  return `你会读到用户追踪「${threadName}」这条脉络的所有记录（${entryCount} 条，${dateRange}）。

完成以下两件事，输出一个 JSON，不要解释：

────────────────────────────────────
【任务一：挑碎片】

从记录里挑 2–5 句原句，标准：
- 每句里有一个具体的发现、悖论、或行为转变
- 句子之间不能说同一件事
- 用原文，不改写，不截断到语义不完整

────────────────────────────────────
【任务二：写此刻这里】

读完所有记录后，写 3–5 句话描述这条脉络「目前在哪里」——
不是它经历了什么，而是此刻这个主题的状态和方向。

必须做到：
- 用试探性语言：「似乎」「好像」「目前」「可能」「也许」
- 用用户自己写过的词或场景
- 描述变化和方向，不描述固化特质

绝对不能：
- 「你是一个……的人」「你总是……」「你一直……」
- 「这说明……」「这意味着……」「由此可见……」
- 「建议你……」「你应该……」「你可以试试……」
- 超过 5 句
- 通用句（「你在成长」「你承受了很多」）

如果记录只有 1–2 条：不要强行描述轨迹，只描述此刻看到的状态。
如果记录跨度很长：聚焦最近几条，描述当下方向，不试图概括全部历史。

────────────────────────────────────
【输出格式】

{
  "fragments": [
    { "quote": "原句", "date": "YYYY/MM/DD" },
    { "quote": "原句", "date": "YYYY/MM/DD" }
  ],
  "current_state": "3–5句话，此刻这里。"
}

以下是记录：

${entriesText}`
}
```

- [ ] **Step 2：在 `src/lib/threadService.js` 中新增 `generateThreadAnalysis`**

**2a：在文件顶部 import 块中加入 `buildThreadAnalysisPrompt` 的引用**

找到文件顶部已有的 import 行（如 `import { callAI } from './aiClient'`），在 import 块内任意位置追加一行：
```js
import { buildThreadAnalysisPrompt } from './prompts'
```

> ⚠️ import 必须在文件顶层，绝对不能放在函数体或文件末尾的追加位置。

**2b：在文件末尾追加函数体（不含 import 行）**

```js
// ── 生成脉络详情分析（碎片 + 此刻这里）────────────────────────
// 用完整 content 字段（不用摘要），过滤 removed_by_user=true 的条目
export async function generateThreadAnalysis(threadId, userId) {
  // Step 1：拉取 thread_entries（含 removed_by_user 和完整 journal_entries.content）
  const { data: rows, error: rowErr } = await db.from('thread_entries')
    .select('removed_by_user, journal_entries(id, content, created_at)')
    .eq('thread_id', threadId)
    .order('added_at', { ascending: true })

  if (rowErr) {
    console.error('[generateThreadAnalysis] 读取条目失败:', rowErr.message)
    return { error: rowErr }
  }

  // Step 2：过滤 removed_by_user=true，取完整 content
  const entries = (rows ?? [])
    .filter(r => !r.removed_by_user && r.journal_entries?.content)
    .map(r => ({
      date: r.journal_entries.created_at.slice(0, 10).replace(/-/g, '/'),
      content: r.journal_entries.content,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (entries.length === 0) return { error: new Error('无有效条目') }

  // Step 3：拉取脉络名称
  const { data: thread, error: threadErr } = await db.from('threads')
    .select('name')
    .eq('id', threadId)
    .eq('user_id', userId)
    .single()

  if (threadErr || !thread) return { error: threadErr }

  // Step 4：调用 AI
  const prompt = buildThreadAnalysisPrompt(thread.name, entries)
  let raw
  try {
    raw = await callAI(
      [{ role: 'user', content: prompt }],
      '你是用户的内心陪伴者，帮助用户看见自己追踪的主题此刻在哪里。',
      { maxTokens: 800 }
    )
  } catch (e) {
    console.error('[generateThreadAnalysis] AI 调用失败:', e.message)
    return { error: e }
  }

  // Step 5：解析 JSON
  let parsed
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    // 提取第一个 { ... } 块
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('未找到 JSON 对象')
    parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed.fragments) || typeof parsed.current_state !== 'string') {
      throw new Error('JSON 结构不符预期')
    }
  } catch (e) {
    console.error('[generateThreadAnalysis] JSON 解析失败:', e.message, raw.slice(-300))
    return { error: e }
  }

  // Step 6：存入 DB
  const { error: saveErr } = await db.from('threads')
    .update({
      fragments: parsed.fragments,
      current_state: parsed.current_state.trim(),
      analysis_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('user_id', userId)

  if (saveErr) {
    console.error('[generateThreadAnalysis] 存储失败:', saveErr.message)
    return { error: saveErr }
  }

  return { fragments: parsed.fragments, current_state: parsed.current_state.trim(), error: null }
}
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/lib/prompts.js src/lib/threadService.js
git commit -m "feat: 脉络分析 buildThreadAnalysisPrompt + generateThreadAnalysis"
```

---

## Task 2：ThreadDetailPage.jsx — 替换 arc_summary 区块，加分析按钮

**Files:**
- Modify: `src/pages/ThreadDetailPage.jsx`

### 背景

- 现有 arc_summary 区块（第 499–532 行，「变化轨迹」卡片）**整体替换**为「一些碎片」+「此刻这里」两个区块
- 底部加「重新分析」固定按钮（非归档态下显示）
- ··· 菜单的「🔄 重新分析」改名为「🔍 查找新记录」，功能不变（仍调用 `handleReAnalyze`）
- import 里加 `generateThreadAnalysis`

- [ ] **Step 1：在 import 行引入 `generateThreadAnalysis`**

找到第 8–15 行 import：
```js
import {
  fetchThreadWithEntries,
  updateThread,
  deleteThread,
  refreshArcSummary,
  addEntryToThread,
  reAnalyzeThread,
} from '../lib/threadService'
```

替换为：
```js
import {
  fetchThreadWithEntries,
  updateThread,
  deleteThread,
  addEntryToThread,
  reAnalyzeThread,
  generateThreadAnalysis,
} from '../lib/threadService'
```

（去掉 `refreshArcSummary`，不再需要）

- [ ] **Step 2：新增 `analyzing` state，删除 `refreshing`/`arcStale` state**

找到：
```js
  // arc_summary 刷新
  const [refreshing, setRefreshing] = useState(false)
```

替换为：
```js
  // 脉络分析
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
```

同时删除：
```js
  const [arcStale, setArcStale] = useState(false)  // 编辑后 arc_summary 过期
```

- [ ] **Step 3：新增 `handleGenerateAnalysis` 函数，删除 `handleRefreshArc`**

找到并删除整个 `handleRefreshArc` 函数（第 111–119 行）：
```js
  // ── arc_summary 刷新 ──────────────────────────────────────────
  async function handleRefreshArc() {
    ...
  }
```

在其位置插入：
```js
  // ── 生成脉络分析（碎片 + 此刻这里）────────────────────────────
  async function handleGenerateAnalysis() {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeError('')
    const { fragments, current_state, error } = await generateThreadAnalysis(thread.id, user.id)
    if (error) {
      setAnalyzeError('分析失败，请检查网络后重试')
    } else {
      setThread(prev => ({ ...prev, fragments, current_state }))
    }
    setAnalyzing(false)
  }
```

- [ ] **Step 4：删除 handleRemoveEntry/handleAddEntry 里的 `setArcStale(true)` 调用**

在 `handleRemoveEntry`（约第 248–256 行）找到：
```js
    setArcStale(true)
```
删除这一行。

在 `handleAddEntry`（约第 259–266 行）同样找到并删除 `setArcStale(true)`。

- [ ] **Step 5：··· 菜单「重新分析」改名为「查找新记录」**

找到菜单数组里：
```js
{ label: reanalyzing ? '🔄 分析中…' : '🔄 重新分析', action: handleReAnalyze, color: '#333' },
```

替换为：
```js
{ label: reanalyzing ? '🔍 查找中…' : '🔍 查找新记录', action: handleReAnalyze, color: '#333' },
```

- [ ] **Step 6：替换 arc_summary 区块（第 499–532 行）为碎片+此刻两个区块**

找到整个 arc_summary 卡片（从 `{/* arc_summary 区 */}` 到结束 `</div>` 约第 499–532 行）：
```jsx
        {/* arc_summary 区 */}
        <div style={{ background: isArchived ? '#f5f3ef' : '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          ...（整个卡片内容）...
        </div>
```

整体替换为：
```jsx
        {/* ── 一些碎片 ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500, marginBottom: 10 }}>一些碎片</div>
          {thread.fragments?.length > 0 ? (
            thread.fragments.map((f, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75, fontStyle: 'italic' }}>
                  「{f.quote}」
                </div>
                <div style={{ fontSize: 11, color: '#bbb', textAlign: 'right', marginTop: 2 }}>
                  {f.date}
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65 }}>
              {analyzing ? '分析中…' : entries.length === 0 ? '关联记录后可生成分析' : '点击下方「开始分析」生成'}
            </div>
          )}
        </div>

        {/* ── 此刻这里 ── */}
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500, marginBottom: 8 }}>此刻这里</div>
          {thread.current_state ? (
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75 }}>
              {thread.current_state}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65 }}>
              {analyzing ? '分析中…' : entries.length === 0 ? '关联记录后可生成分析' : '点击下方「开始分析」生成'}
            </div>
          )}
          {thread.analysis_generated_at && (
            <div style={{ fontSize: 10, color: '#ccc', marginTop: 6 }}>
              AI 生成 · {new Date(thread.analysis_generated_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
            </div>
          )}
        </div>

        {analyzeError && (
          <div style={{ fontSize: 12, color: '#e05252', marginBottom: 12 }}>{analyzeError}</div>
        )}
```

- [ ] **Step 7：在「走过的路」标签前更新关联记录区块标题**

找到（约第 534–536 行）：
```jsx
        {/* 关联记录列表 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>
```

替换为：
```jsx
        {/* 走过的路 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          走过的路（{entries.length} 条）
        </div>
```

- [ ] **Step 8：在归档态底部操作栏之前插入「分析」按钮（非归档态显示）**

找到（约第 562–574 行）：
```jsx
      {/* 归档态底部固定操作栏 */}
      {isArchived && (
```

在这个块之前插入：
```jsx
      {/* 分析按钮（非归档态，有条目时显示） */}
      {!isArchived && entries.length > 0 && (
        <div style={{ padding: '10px 18px 16px', background: '#faf8f4', borderTop: '1px solid #ede9e2', flexShrink: 0 }}>
          <button
            onClick={handleGenerateAnalysis}
            disabled={analyzing}
            style={{
              width: '100%', padding: '12px', borderRadius: 10,
              border: '1px solid #f0e4cc', background: analyzing ? '#f5f3ef' : 'white',
              color: analyzing ? '#ccc' : '#c9a96e', fontSize: 14, cursor: analyzing ? 'default' : 'pointer',
            }}
          >
            {analyzing ? '分析中…' : thread.fragments ? '重新分析' : '开始分析'}
          </button>
        </div>
      )}

```

- [ ] **Step 9：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 10：Commit**

```bash
git add src/pages/ThreadDetailPage.jsx
git commit -m "feat: 脉络详情页新增碎片+此刻分析区块，替换 arc_summary"
```

---

## Task 3：本地验收

```bash
npm run dev
```

**验收清单：**

1. 进入一条有多个关联记录的脉络，看到「一些碎片」和「此刻这里」显示占位文字，底部有「开始分析」按钮
2. 点击「开始分析」，按钮变「分析中…」，完成后显示 2–5 句碎片引用（带日期）和 3–5 句此刻文字
3. 碎片引用的句子可以在原始条目里找到原文（不是 AI 编造）
4. 「此刻这里」有试探性语言（似乎/好像/目前），无建议/诊断/标签
5. 「走过的路」条目列表正常，点击条目可跳转详情
6. ··· 菜单显示「查找新记录」（不再是「重新分析」），功能不变
7. 有内容后按钮显示「重新分析」，点击后内容刷新，生成时间戳更新
8. 归档态脉络不显示分析按钮
