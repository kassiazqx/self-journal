# Threads + 洞察 + 回顾信增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现第二阶段第二批功能：脉络系统（Threads）、回顾信生成流程重构、洞察页增强、笔记详情页摘要索引区。

**Architecture:** 新增两张 DB 表（threads / thread_entries）和三个新字段（entry_summary / theme_hints / covered_by_letter_id）；新增四个 lib 服务层文件（extractSummaryService / threadService）；现有 reviewLetterService / prompts.js 重构；新增三个页面组件（ThreadsPage / ThreadDetailPage / ReviewLetterListPage）；InsightsPage / RecordDetail / HomePage / MainLayout 各自扩展。

**Tech Stack:** React + Vite, Supabase (db.js 适配层), Google Gemini, Node built-in test runner (`node:test`)

---

## ⚠️ 冷启动必读（Task 0）

**代码 session 开始前，必须先完成以下确认：**

- [ ] **Step 1: 读架构上下文**

```bash
# 必读以下章节，不可跳过
# docs/arch-context.md §2（架构决策）
# docs/arch-context.md §4.6 §4.7 §4.12 §4.13（高优先级风险）
# docs/arch-context.md §5.7（thread_entries RLS 规范）
```

关键结论（确认你已理解）：
- `journalService.js` 仍直接用 supabase（存量问题，本批不迁移）
- 新代码必须走 `db.js`，不能直接 import supabase
- `conversations` 表用 UPSERT，不用 INSERT
- `EditableFieldRow` 组件**不存在**，必须新建，不能说"复用"
- `thread_entries` 无 `user_id`，RLS 必须通过子查询 threads 表过滤

- [ ] **Step 2: 读新 spec**

```bash
# docs/superpowers/specs/2026-04-11-threads-insights-design.md
# 重点读：§2（DB 变更）§5.2（回顾信生成 7 步流程）§9（开发注意事项）
```

- [ ] **Step 3: 确认现有代码状态**

```bash
node --version  # 确认 Node ≥ 18（built-in test runner 需要）
cat src/lib/reviewLetterService.js | head -60   # 确认旧版读 content 字段
cat src/lib/prompts.js | tail -30               # 确认旧版 JSON 结构
```

预期看到：`getReviewLetterPrompt` 末尾 JSON 含 `recurring_emotions` 等旧字段。

---

## 文件结构总览

```
新建文件：
  src/lib/extractSummaryService.js   摘要索引批量提取服务
  src/lib/threadService.js           脉络 CRUD + 加权召回 + arc_summary
  src/pages/ThreadsPage.jsx          脉络列表页
  src/pages/ThreadDetailPage.jsx     脉络详情页
  src/pages/ReviewLetterListPage.jsx 回顾信列表页

修改文件：
  src/lib/prompts.js                 回顾信 prompt → suggested_threads JSON 结构
  src/lib/reviewLetterService.js     读 entry_summary/theme_hints；写 covered_by_letter_id；触发计数改负向排除
  src/lib/insightsService.js         增加 confirmedThreads + allLetters 查询
  src/components/RecordDetail.jsx    新增摘要索引区（新建 EditableFieldRow）+ 🧵 脉络标签
  src/pages/HomePage.jsx             新增未读回顾信气泡
  src/pages/InsightsPage.jsx         新增回顾信 + 脉络入口区块
  src/components/MainLayout.jsx      新增 thread / thread_detail / letter_list 屏幕类型
```

---

## Task 1: 数据库变更（必须最先完成，其他 Task 依赖此步）

**Files:**
- 无代码文件，全是 SQL（在 Supabase Dashboard → SQL Editor 执行）

- [ ] **Step 1: 在 Supabase SQL Editor 执行 — journal_entries 新增字段**

```sql
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_summary   text,
  ADD COLUMN IF NOT EXISTS theme_hints     text[],
  ADD COLUMN IF NOT EXISTS covered_by_letter_id uuid
    REFERENCES review_letters(id) ON DELETE SET NULL;
```

预期：`Success. No rows returned`，无报错。

- [ ] **Step 2: 执行 — 创建 threads 表**

```sql
CREATE TABLE IF NOT EXISTS threads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'candidate'
                 CHECK (status IN ('candidate','confirmed','archived')),
  arc_summary    text,
  arc_updated_at timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
```

- [ ] **Step 3: 执行 — 创建 thread_entries 联结表**

```sql
CREATE TABLE IF NOT EXISTS thread_entries (
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  added_at   timestamptz DEFAULT now(),
  added_by   text NOT NULL CHECK (added_by IN ('ai','user')),
  PRIMARY KEY (thread_id, entry_id)
);
```

- [ ] **Step 4: 执行 — 启用 RLS 并添加策略**

```sql
-- threads 表 RLS
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads_user_isolation" ON threads
  FOR ALL USING (user_id = auth.uid());

-- thread_entries 表 RLS（⚠️ 无 user_id 字段，必须通过子查询过滤）
ALTER TABLE thread_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "thread_entries_user_isolation" ON thread_entries
  FOR ALL USING (
    thread_id IN (
      SELECT id FROM threads WHERE user_id = auth.uid()
    )
  );
```

- [ ] **Step 5: 验证表结构**

在 SQL Editor 执行：

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'journal_entries'
  AND column_name IN ('entry_summary', 'theme_hints', 'covered_by_letter_id');

SELECT table_name FROM information_schema.tables
WHERE table_name IN ('threads', 'thread_entries');
```

预期：返回 5 行（3 个新字段 + 2 张新表）。

- [ ] **Step 6: 确认无误后，在 §6 同步摘要日志追加一行**

```
2026-04-XX · 代码session · Task 1 完成：journal_entries 新增 3 字段；创建 threads / thread_entries 表及 RLS 策略
```

---

## Task 2: 重构 prompts.js + reviewLetterService.js（修复 4.6 / 4.7 / 4.13）

> ⚠️ **执行顺序注意：Task 2B（reviewLetterService 重构）依赖 Task 3（extractSummaryService.js）。**
> **正确执行顺序：Task 1 → Task 3 → Task 2 → Task 4 → ...**
> Task 2A（prompts.js 修改）可以先做；Task 2B 必须等 Task 3 完成后再做。

**Files:**
- Modify: `src/lib/prompts.js`
- Modify: `src/lib/reviewLetterService.js`

### 2A: 更新 prompts.js 回顾信 prompt

- [ ] **Step 1: 修改 getReviewLetterPrompt 函数**

打开 `src/lib/prompts.js`，找到并替换最后的 `getReviewLetterPrompt` 函数（当前接收 `entriesText` 字符串，JSON 结构是旧版）：

```js
// ─── 回顾信生成 prompt（第二批版本）──────────────────────────────
// 入参改为 entries 摘要数组，不传原始 content（省 token + 保护隐私）
// JSON 结构改为 suggested_threads（spec §5.2）
export function getReviewLetterPrompt(entriesSummary) {
  // entriesSummary: [{ date, entry_summary, theme_hints, core_needs }]
  const entriesText = entriesSummary.map((e, i) =>
    `[第${i + 1}条，${e.date}]\n摘要：${e.entry_summary ?? '（无摘要）'}\n主题标签：${(e.theme_hints ?? []).join('、') || '无'}\n核心需求：${(e.core_needs ?? []).join('、') || '无'}`
  ).join('\n\n---\n\n')

  return `你会收到用户这段时间的日记摘要。请写一封温暖的回顾信，语气像一位长期陪伴的朋友。

要求：
- 不评判，不说教，不鼓励"你下次应该..."
- 帮助用户看见反复出现的情绪和模式
- 用具体细节（用户自己写的词和场景），而不是泛泛而谈
- 结尾留一个轻柔的问题或邀请，用户可以选择回应也可以不回应
- 长度：300-500字

写完信之后，在信的最后附上以下JSON（不要解释，直接输出）：
\`\`\`json
{
  "suggested_threads": [
    { "action": "link", "thread_id": "已有脉络的uuid或null", "thread_name": "脉络名称" },
    { "action": "create", "thread_id": null, "thread_name": "建议新建的脉络名称" }
  ]
}
\`\`\`
action 说明：
- "link" = 与已有脉络关联（thread_id 填已有脉络的 uuid）
- "create" = 建议新建脉络候选（thread_id 填 null）
如果没有可关联或建议新建的脉络，returned "suggested_threads": []

以下是用户的日记摘要：

${entriesText}`
}
```

- [ ] **Step 2: 验证编译**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build 2>&1 | tail -20
```

预期：`✓ built in` 无报错。

### 2B: 重构 reviewLetterService.js

- [ ] **Step 3: 替换 generateReviewLetter 函数**

打开 `src/lib/reviewLetterService.js`，**先在文件顶部 import 区追加**（§4.14：用静态 import，不用动态 import）：

```js
import { extractEntrySummaries } from './extractSummaryService.js'
```

然后将整个 `generateReviewLetter` 函数（第 42-99 行）替换：

```js
// ── 生成回顾信 ────────────────────────────────────────────────
async function generateReviewLetter(userId, periodStart, prefs) {
  const periodEnd = new Date().toISOString()

  // Step 1: 取最近 6~8 条 covered_by_letter_id IS NULL 的 entry（排除随手记）
  const { data: entries } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, created_at')
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(8)

  if (!entries?.length) throw new Error('NO_ENTRIES')

  // Step 2: 批量补提取缺失的 entry_summary / theme_hints
  // （extractEntrySummaries 已在文件顶部静态 import，见 §4.14 注意事项）
  const needExtract = entries.filter(e => !e.entry_summary)
  if (needExtract.length > 0) {
    await extractEntrySummaries(userId, needExtract.map(e => e.id))

    // 重新读取，拿到最新摘要
    const { data: refreshed } = await db.from('journal_entries')
      .select('id, entry_summary, theme_hints, core_needs, created_at')
      .in('id', entries.map(e => e.id))
      .order('created_at', { ascending: true })
    if (refreshed) entries.splice(0, entries.length, ...refreshed)
  }

  // Step 3: 构建摘要数组传 AI（不传原始 content）
  const entriesSummary = entries.map(e => ({
    date: e.created_at.slice(0, 10),
    entry_summary: e.entry_summary,
    theme_hints: e.theme_hints,
    core_needs: e.core_needs,
  }))

  const prompt = getReviewLetterPrompt(entriesSummary)
  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1200 }
  )

  // Step 4: 提取末尾 JSON
  const insightsMatch = rawLetter.match(/```json([\s\S]*?)```/)
  let insights = { suggested_threads: [] }
  if (insightsMatch) {
    try { insights = JSON.parse(insightsMatch[1]) }
    catch (e) {
      console.warn('[reviewLetter] insights JSON 解析失败:', e)
      console.warn('[reviewLetter] 原始返回前 500 字符:', rawLetter.slice(0, 500))
    }
  } else {
    console.warn('[reviewLetter] 未找到 JSON 块，rawLetter 前 300 字符:', rawLetter.slice(0, 300))
  }
  const letterContent = rawLetter.replace(/```json[\s\S]*?```/, '').trim()

  // Step 5: 保存 review_letter
  const { data: letter, error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    insights,
    trigger_type: prefs.type,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  }).select('id').single()

  if (error) {
    console.error('[reviewLetter] 插入失败:', error.message)
    throw error
  }

  // Step 6: 回写 covered_by_letter_id（修复 4.7）
  const { error: updateError } = await db.from('journal_entries')
    .update({ covered_by_letter_id: letter.id })
    .in('id', entries.map(e => e.id))
    .eq('user_id', userId)
  if (updateError) {
    // 不抛出：信已生成，回写失败只影响下次计数
    console.error('[reviewLetter] covered_by_letter_id 回写失败:', updateError.message)
  }

  return true
}
```

- [ ] **Step 4: 修改 checkAndGenerateLetter 计数逻辑（负向排除 freewrite）**

找到 `checkAndGenerateLetter` 里的计数查询，将旧白名单替换：

```js
  // 替换前（旧版白名单）：
  // .in('template_type', ['awareness', 'emotion', 'gratitude'])

  // 替换后（负向排除，与 spec §5.1 对齐）：
  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')
```

- [ ] **Step 5: 验证编译**

```bash
npm run build 2>&1 | tail -20
```

预期无报错。`extractSummaryService.js` 是动态 import，build 阶段不检查，运行时会在 Task 3 之后正常工作。

---

## Task 3: 新建 extractSummaryService.js（懒触发批量摘要提取）

**Files:**
- Create: `src/lib/extractSummaryService.js`

- [ ] **Step 1: 写测试文件（先跑，预期 FAIL）**

创建 `src/lib/extractSummaryService.test.js`：

```js
// src/lib/extractSummaryService.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// 测试 buildSummaryPrompt 纯函数（不依赖网络/DB）
import { buildSummaryPrompt } from './extractSummaryService.js'

describe('buildSummaryPrompt', () => {
  test('returns a string containing the content', () => {
    const entries = [
      { id: 'abc', content: '今天在地铁上很烦躁' },
      { id: 'def', content: '感觉很疲惫，不想说话' },
    ]
    const prompt = buildSummaryPrompt(entries)
    assert.ok(typeof prompt === 'string', '应返回字符串')
    assert.ok(prompt.includes('地铁上很烦躁'), '应包含 entry 内容')
    assert.ok(prompt.includes('entry_summary'), '应包含字段名 entry_summary')
    assert.ok(prompt.includes('theme_hints'), '应包含字段名 theme_hints')
  })

  test('handles empty entries gracefully', () => {
    const prompt = buildSummaryPrompt([])
    assert.ok(typeof prompt === 'string')
  })
})
```

```bash
node --test src/lib/extractSummaryService.test.js
```

预期：FAIL（`extractSummaryService.js` 还不存在）。

- [ ] **Step 2: 创建 extractSummaryService.js**

创建 `src/lib/extractSummaryService.js`：

```js
// src/lib/extractSummaryService.js
// 懒触发批量提取 entry_summary + theme_hints
// 仅在上层功能需要时调用（生成回顾信前、分析脉络前），不在保存时自动调
import { db } from './db'
import { callAI } from './aiClient'

// ── 构建批量摘要提取 prompt（纯函数，可单独测试）──────────────
export function buildSummaryPrompt(entries) {
  // entries: [{ id, content }]
  const entriesText = entries.map((e, i) =>
    `[条目${i + 1}，id: ${e.id}]\n${e.content}`
  ).join('\n\n---\n\n')

  return `请对以下日记条目逐条提取摘要索引，以 JSON 数组格式返回，不要有任何其他文字。

每条格式：
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "一句完整陈述句，20~45字，记录发生了什么+用户的核心反应，不做评价，不写时间地点细节",
  "theme_hints": ["2~4个短语，每个4~10字，写可复用的心理主题，三个月后还能帮助识别同类记录"]
}

entry_summary 示例：
✅ "地铁上被吵闹乘客影响，用慈悲心压下烦躁，但发现对完全平静的期待让自己更累"
❌ "4月10日早上在1号线地铁上遇到男生叫嚷" （含具体时间地点，不可用）

theme_hints 示例：
✅ ["公共场所刺激敏感", "内心平静标准", "慈悲练习"]
❌ ["地铁", "4月10日", "男生叫嚷"] （一次性事件细节，不可用）

以下是需要提取的日记条目：

${entriesText}

只返回 JSON 数组，不要解释，不要 markdown 代码块。`
}

// ── 批量提取（最多 10 条，超出分批）─────────────────────────
export async function extractEntrySummaries(userId, entryIds) {
  if (!entryIds?.length) return

  const BATCH_SIZE = 10
  for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
    const batch = entryIds.slice(i, i + BATCH_SIZE)
    await extractBatch(userId, batch)
  }
}

async function extractBatch(userId, entryIds) {
  // 读取原始内容
  const { data: entries, error } = await db.from('journal_entries')
    .select('id, content')
    .eq('user_id', userId)
    .in('id', entryIds)

  if (error || !entries?.length) {
    console.error('[extractSummary] 读取 entries 失败:', error?.message)
    return
  }

  const prompt = buildSummaryPrompt(entries)

  let rawResponse
  try {
    rawResponse = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一个精准的信息提取助手，只返回 JSON，不附加任何解释。',
      { maxTokens: 800 }
    )
  } catch (e) {
    console.error('[extractSummary] AI 调用失败:', e.message)
    return
  }

  let results
  try {
    // 去除可能的 markdown 代码块包装
    const cleaned = rawResponse.replace(/```json|```/g, '').trim()
    results = JSON.parse(cleaned)
    if (!Array.isArray(results)) throw new Error('不是数组')
  } catch (e) {
    console.error('[extractSummary] JSON 解析失败:', e.message)
    console.warn('[extractSummary] 原始返回:', rawResponse.slice(0, 400))
    return
  }

  // 写回 DB（逐条 update，部分失败不影响其他条）
  await Promise.all(results.map(async (r) => {
    if (!r.id || !r.entry_summary) return
    const { error } = await db.from('journal_entries')
      .update({
        entry_summary: r.entry_summary,
        theme_hints: Array.isArray(r.theme_hints) ? r.theme_hints : [],
      })
      .eq('id', r.id)
      .eq('user_id', userId)
    if (error) {
      console.error(`[extractSummary] 写回 ${r.id} 失败:`, error.message)
    }
  }))
}
```

- [ ] **Step 3: 跑测试，预期 PASS**

```bash
node --test src/lib/extractSummaryService.test.js
```

预期输出：
```
▶ buildSummaryPrompt
  ✓ returns a string containing the content
  ✓ handles empty entries gracefully
▶ buildSummaryPrompt (Xms)
```

- [ ] **Step 4: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：无报错。

---

## Task 4: 新建 threadService.js（脉络 CRUD + 加权召回 + arc_summary）

**Files:**
- Create: `src/lib/threadService.js`
- Create: `src/lib/threadService.test.js`

- [ ] **Step 1: 写测试（先跑，预期 FAIL）**

创建 `src/lib/threadService.test.js`：

```js
// src/lib/threadService.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { scoreEntryForThread, buildArcSummaryPrompt } from './threadService.js'

describe('scoreEntryForThread', () => {
  const thread = {
    representativeNeeds: ['被理解', '安全感'],
    representativeHints: ['公共场所刺激', '内心平静标准'],
    representativeEmotions: ['焦虑', '烦躁'],
    representativeTags: ['社交'],
  }

  test('core_needs overlap +3 each', () => {
    const entry = { core_needs: ['被理解'], theme_hints: [], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 3)
  })

  test('theme_hints overlap +3 each', () => {
    const entry = { core_needs: [], theme_hints: ['公共场所刺激'], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 3)
  })

  test('emotions +1, tags +1', () => {
    const entry = { core_needs: [], theme_hints: [], emotions: ['焦虑'], category_tags: ['社交'] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 2)
  })

  test('returns 0 for no overlap', () => {
    const entry = { core_needs: [], theme_hints: [], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 0)
  })
})

describe('buildArcSummaryPrompt', () => {
  test('includes thread name and entry summaries', () => {
    const thread = { name: '内心平静探索' }
    const entries = [
      { created_at: '2026-03-10', entry_summary: '第一次记录', theme_hints: ['平静标准'] },
      { created_at: '2026-04-01', entry_summary: '慢慢接受有反应的自己', theme_hints: [] },
    ]
    const prompt = buildArcSummaryPrompt(thread, entries)
    assert.ok(prompt.includes('内心平静探索'))
    assert.ok(prompt.includes('第一次记录'))
    assert.ok(prompt.includes('慢慢接受有反应的自己'))
  })
})
```

```bash
node --test src/lib/threadService.test.js
```

预期：FAIL（文件不存在）。

- [ ] **Step 2: 创建 threadService.js**

创建 `src/lib/threadService.js`：

```js
// src/lib/threadService.js
// 脉络 CRUD + 加权召回 + arc_summary 生成
import { db } from './db'
import { callAI } from './aiClient'

// ── 加权评分（纯函数）────────────────────────────────────────
export function scoreEntryForThread(entry, thread) {
  let score = 0
  const overlap = (arr1, arr2) =>
    (arr1 ?? []).filter(x => (arr2 ?? []).includes(x)).length
  score += overlap(entry.core_needs, thread.representativeNeeds) * 3
  score += overlap(entry.theme_hints, thread.representativeHints) * 3
  score += overlap(entry.emotions, thread.representativeEmotions) * 1
  score += overlap(entry.category_tags, thread.representativeTags) * 1
  return score
}

// ── arc_summary prompt（纯函数）──────────────────────────────
export function buildArcSummaryPrompt(thread, entries) {
  const entriesText = entries.map((e, i) =>
    `[第${i + 1}条，${e.created_at?.slice(0, 10) ?? ''}]\n${e.entry_summary ?? ''}\n主题：${(e.theme_hints ?? []).join('、') || '无'}`
  ).join('\n\n')

  return `这是用户持续追踪的主题脉络：「${thread.name}」

以下是按时间排列的相关记录摘要：

${entriesText}

请写一段变化轨迹（arc_summary）：
- 使用试探性语言：「这段时间似乎…」「也许正在从…走向…」
- 聚焦变化，不做永久性定性（禁止「你是一个…的人」）
- 100~200字，直接开始叙事，不加标题`
}

// ── 查询 ──────────────────────────────────────────────────────
export async function fetchThreads(userId) {
  return db.from('threads')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
}

export async function fetchThreadWithEntries(threadId) {
  const [threadRes, entriesRes] = await Promise.all([
    db.from('threads').select('*').eq('id', threadId).single(),
    db.from('thread_entries')
      .select('entry_id, added_at, added_by, journal_entries(id, entry_summary, created_at, template_type)')
      .eq('thread_id', threadId)
      .order('added_at', { ascending: true }),
  ])
  return { thread: threadRes.data, entries: entriesRes.data ?? [], error: threadRes.error }
}

// ── 写入 ──────────────────────────────────────────────────────
export async function createThread(userId, { name, status = 'confirmed' }) {
  return db.from('threads')
    .insert({ user_id: userId, name, status })
    .select('id, name, status')
    .single()
}

export async function updateThread(threadId, userId, fields) {
  return db.from('threads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('user_id', userId)
}

export async function deleteThread(threadId, userId) {
  return db.from('threads')
    .delete()
    .eq('id', threadId)
    .eq('user_id', userId)
}

export async function addEntryToThread(threadId, entryId, addedBy = 'user') {
  return db.from('thread_entries')
    .upsert({ thread_id: threadId, entry_id: entryId, added_by: addedBy })
}

export async function removeEntryFromThread(threadId, entryId) {
  return db.from('thread_entries')
    .delete()
    .eq('thread_id', threadId)
    .eq('entry_id', entryId)
}

// ── 本地加权召回（零 token）──────────────────────────────────
export function recallCandidateEntries(candidates, thread, topN = 20) {
  return candidates
    .map(entry => ({ entry, score: scoreEntryForThread(entry, thread) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ entry }) => entry)
}

// ── 生成 arc_summary ──────────────────────────────────────────
export async function refreshArcSummary(threadId, userId) {
  const { thread, entries } = await fetchThreadWithEntries(threadId)
  const entryData = entries
    .map(e => e.journal_entries)
    .filter(Boolean)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  if (!thread || entryData.length < 2) return

  const prompt = buildArcSummaryPrompt(thread, entryData)
  let arcSummary
  try {
    arcSummary = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一位温和的觉察引导者，帮助用户看见自己随时间的变化。',
      { maxTokens: 400 }
    )
  } catch (e) {
    console.error('[threadService] arc_summary 生成失败:', e.message)
    return
  }

  await db.from('threads')
    .update({
      arc_summary: arcSummary.trim(),
      arc_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('user_id', userId)
}
```

- [ ] **Step 3: 跑测试，预期 PASS**

```bash
node --test src/lib/threadService.test.js
```

预期全部 PASS（6 个测试）。

- [ ] **Step 4: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

---



## Task 5: 扩展 insightsService.js + 更新 InsightsPage.jsx

**Files:**
- Modify: `src/lib/insightsService.js`
- Modify: `src/pages/InsightsPage.jsx`

### 5A: insightsService 增加 threads + allLetters 查询

- [ ] **Step 1: 在 insightsService.js 的 Promise.all 里增加两个查询**

打开 `src/lib/insightsService.js`，在 `loadInsightsData` 的 `Promise.all` 数组末尾追加两个查询（当前是 5 个，追加为 7 个）：

```js
  const [moodRes, emotionRes, needsRes, letterRes, tagsRes, threadsRes, lettersRes] = await Promise.all([
    // ... 原有的 5 个查询保持不变 ...

    // 已确认脉络（洞察页展示最多 3 条）
    db.from('threads')
      .select('id, name, status, arc_summary, updated_at')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .order('updated_at', { ascending: false })
      .limit(3),

    // 全部回顾信（回顾信列表页用）
    db.from('review_letters')
      .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])
```

然后在 return 语句里追加两个字段：

```js
  return {
    moodData:         moodRes.data ?? [],
    emotionCounts:    Object.entries(eCounts).map(([label, count]) => ({ label, count })),
    needsCounts:      Object.entries(nCounts).map(([label, count]) => ({ label, count })),
    tagCounts:        Object.entries(tCounts).map(([label, count]) => ({ label, count })),
    latestLetter:     letterRes.data ?? null,
    confirmedThreads: threadsRes.data ?? [],   // 新增
    allLetters:       lettersRes.data ?? [],   // 新增
    error: moodRes.error ?? null,
  }
```

- [ ] **Step 2: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

### 5B: InsightsPage 增加回顾信 + 脉络入口区块

- [ ] **Step 3: 修改 InsightsPage.jsx**

在 `InsightsPage.jsx` 的 `export default function InsightsPage()` 函数签名中增加 props，并更新 state / load 逻辑：

```jsx
// 新增 props（来自 MainLayout 传入的导航函数）
export default function InsightsPage({ onOpenLetterList, onOpenThreads, onOpenThread }) {
```

在 state 声明中增加两个新字段：

```js
  const [confirmedThreads, setConfirmedThreads] = useState([])
  const [allLetters, setAllLetters] = useState([])
```

在 `load()` 函数中追加赋值：

```js
      setConfirmedThreads(result.confirmedThreads)
      setAllLetters(result.allLetters)
```

- [ ] **Step 4: 在"── 最近 30 天 ──"分隔线之前插入回顾信区块**

找到 `InsightsPage.jsx` 中的这段 JSX：

```jsx
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 16,
        letterSpacing: '0.5px', textAlign: 'center' }}>
        ── 最近 30 天 ──
      </div>
```

在它之前插入：

```jsx
      {/* ── 回顾信入口区块 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>回顾信</span>
          {allLetters.length > 0 && (
            <button
              onClick={onOpenLetterList}
              style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              查看全部 →
            </button>
          )}
        </div>
        {latestLetter ? (
          <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4',
            borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}
            onClick={onOpenLetterList}>
            <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 6 }}>
              ✉ 最新回顾信
              {!latestLetter.is_read && (
                <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: '50%',
                  background: '#c9a96e', display: 'inline-block', verticalAlign: 'middle' }} />
              )}
            </div>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {latestLetter.content}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无回顾信（累积 6 条记录后生成）
          </div>
        )}
      </div>

      {/* ── 脉络入口区块 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>脉络</span>
          <button
            onClick={onOpenThreads}
            style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {confirmedThreads.length > 0 ? '查看全部 →' : '+ 新建脉络'}
          </button>
        </div>
        {confirmedThreads.length > 0 ? confirmedThreads.map(thread => (
          <div key={thread.id}
            onClick={() => onOpenThread(thread)}
            style={{ background: 'white', borderRadius: 10, padding: '10px 14px',
              marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, color: '#333', fontWeight: 500, marginBottom: 4 }}>{thread.name}</div>
            {thread.arc_summary && (
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {thread.arc_summary}
              </div>
            )}
          </div>
        )) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无脉络，生成回顾信后 AI 会提议
          </div>
        )}
      </div>
```

- [ ] **Step 5: 删除 InsightsPage 中原有的"最新回顾信预览"区块**

原文件第 106-123 行有一个独立的 `latestLetter` 展示区块，现在已被新区块替代，删除它：

```jsx
      {/* 最新回顾信预览 */}
      {latestLetter && (
        <div style={{ background: '#fffdf8', ...}}>
          ...
        </div>
      )}
```

- [ ] **Step 6: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

注意：InsightsPage 的新 props（`onOpenLetterList` 等）在 MainLayout 连线之前是 undefined，暂时不影响编译，只影响点击。Task 11 会做连线。

---



## Task 6: 更新 RecordDetail.jsx（摘要索引区 + EditableFieldRow + 🧵 脉络标签）

**Files:**
- Modify: `src/components/RecordDetail.jsx`

⚠️ **必读 arch-context §4.12**：`EditableFieldRow` 组件不存在，必须新建，不是"复用"。

- [ ] **Step 1: 新增 EditableFieldRow 组件（在 FieldRow 定义之后添加）**

在 `RecordDetail.jsx` 的 `FieldRow` 组件定义之后，添加：

```jsx
// EditableFieldRow：可内联编辑的字段行（新建，spec §7.1）
function EditableFieldRow({ label, value, displayValue, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() { setDraft(value ?? ''); setEditing(true) }
  function handleSave() { setEditing(false); if (draft !== value) onSave(draft) }

  return (
    <div style={{ display: 'flex', gap: 8, paddingBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 2 }}>
        {label}
      </span>
      {editing ? (
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          onBlur={handleSave}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
          style={{
            flex: 1, border: '1px solid #e0dbd4', borderRadius: 8,
            padding: '4px 8px', fontSize: 13, outline: 'none',
            background: 'white', fontFamily: 'inherit',
          }}
        />
      ) : (
        <span onClick={startEdit}
          style={{ fontSize: 13, color: '#333', lineHeight: 1.6, flex: 1, cursor: 'pointer' }}>
          {displayValue || <span style={{ color: '#ccc' }}>点击添加…</span>}
        </span>
      )}
      <span onClick={startEdit}
        style={{ fontSize: 10, color: '#d4c4b0', cursor: 'pointer', paddingTop: 2, flexShrink: 0 }}>
        ✎
      </span>
    </div>
  )
}
```

- [ ] **Step 2: 增加脉络 state + useEffect**

在 `RecordDetail` 组件的其他 `useState` 声明之后：

```js
  const [entryThreads, setEntryThreads] = useState([])
```

加一个 `useEffect`：

```js
  useEffect(() => {
    async function loadThreads() {
      const { data } = await db.from('thread_entries')
        .select('thread_id, threads(id, name)')
        .eq('entry_id', initialEntry.id)
      setEntryThreads((data ?? []).map(r => r.threads).filter(Boolean))
    }
    loadThreads()
  }, [initialEntry.id])
```

- [ ] **Step 3: 增加摘要字段保存函数（handleFieldSave 之后）**

```js
  async function handleSummarySave(value) {
    const trimmed = value?.trim() || null
    setEntry(e => ({ ...e, entry_summary: trimmed }))
    await handleFieldSave('entry_summary', trimmed)
  }

  async function handleThemeHintsSave(value) {
    const arr = value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean)
    setEntry(e => ({ ...e, theme_hints: arr }))
    await handleFieldSave('theme_hints', arr)
  }
```

- [ ] **Step 4: 插入摘要索引区 JSX（在核心字段区之前）**

找到注释 `{/* ── 核心字段区 ── */}` 之前，插入：

```jsx
        {/* ── 摘要索引区 ── */}
        <div style={{
          marginTop: 14, background: '#fdfcf9',
          borderTop: '1px solid #ede9e2', borderBottom: '1px solid #ede9e2',
          paddingTop: 10, paddingBottom: 4,
          marginLeft: -18, marginRight: -18, paddingLeft: 18, paddingRight: 18,
        }}>
          <div style={{ fontSize: 9, color: '#c8c0b4', fontWeight: 600,
            letterSpacing: '0.04em', marginBottom: 6 }}>
            摘要索引
            <span style={{ fontSize: 8, color: '#d4c8b8', fontWeight: 400, marginLeft: 4 }}>
              · AI 提取，可手动调整
            </span>
          </div>
          <EditableFieldRow
            label="一句话"
            value={entry.entry_summary ?? ''}
            displayValue={entry.entry_summary}
            onSave={handleSummarySave}
          />
          <EditableFieldRow
            label="主题标签"
            value={(entry.theme_hints ?? []).join('、')}
            displayValue={
              entry.theme_hints?.length > 0
                ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {entry.theme_hints.map(h => (
                      <span key={h} style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 8,
                        background: '#f5f0ff', color: '#7a50c0', border: '1px solid #e0d4f8',
                      }}>{h}</span>
                    ))}
                  </div>
                : null
            }
            onSave={handleThemeHintsSave}
          />
        </div>
```

- [ ] **Step 5: 在 category_tags 关联区之后追加脉络标签**

```jsx
        {/* ── 关联脉络 ── */}
        {entryThreads.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {entryThreads.map(thread => (
              <span key={thread.id} style={{
                fontSize: 11, background: '#f5f0ff', color: '#7a50c0',
                border: '1px solid #e0d4f8', borderRadius: 20, padding: '3px 10px',
              }}>
                🧵 {thread.name}
              </span>
            ))}
          </div>
        )}
```

- [ ] **Step 6: 验证编译 + 手动测试**

```bash
npm run build 2>&1 | tail -10
```

手动打开一条记录详情：确认摘要索引区出现、✎ 可点击编辑、无脉络时不显示 🧵 区块。

---

## Task 7: 首页未读回顾信气泡（HomePage.jsx）

**Files:**
- Modify: `src/pages/HomePage.jsx`

- [ ] **Step 1: 增加未读信查询（在组件顶部加 state + useEffect）**

在 `HomePage.jsx` 的 import 区新增：

```js
import { db } from '../lib/db'
```

在组件函数内，`useAuth` 之后，增加 state 和 effect：

```js
  const [unreadLetter, setUnreadLetter] = useState(null)
  const [letterReadTimer, setLetterReadTimer] = useState(null)

  // 查询最新未读回顾信
  useEffect(() => {
    if (!user) return
    async function checkUnread() {
      const { data } = await db.from('review_letters')
        .select('id, content')
        .eq('user_id', user.id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setUnreadLetter(data ?? null)
    }
    checkUnread()
  }, [user])

  // 用户停留 5 秒自动标记已读
  function handleLetterCardView(letter) {
    const timer = setTimeout(async () => {
      await db.from('review_letters')
        .update({ is_read: true })
        .eq('id', letter.id)
      setUnreadLetter(null)
    }, 5000)
    setLetterReadTimer(timer)
  }

  // 清理 timer
  useEffect(() => () => { if (letterReadTimer) clearTimeout(letterReadTimer) }, [letterReadTimer])
```

- [ ] **Step 2: 增加 onOpenLetter prop 并在 JSX 中渲染气泡**

函数签名改为：

```js
export default function HomePage({ onDone, editEntry, onCancel, onOpenLetter }) {
```

在"草稿恢复横幅"之后、"模板标签栏"之前，插入气泡：

```jsx
      {/* ── 未读回顾信气泡 ── */}
      {unreadLetter && (
        <div
          className="px-4 pt-3 fade-in"
          ref={el => { if (el && !letterReadTimer) handleLetterCardView(unreadLetter) }}
        >
          <div
            style={{
              background: '#fffdf8', border: '1px solid #f0e8d4',
              borderRadius: 12, padding: '10px 14px',
              cursor: 'pointer',
            }}
            onClick={() => onOpenLetter?.(unreadLetter)}
          >
            <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 4 }}>
              📬 你有一封新的回顾信
            </div>
            <div style={{
              fontSize: 12, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {unreadLetter.content}
            </div>
            <div style={{ fontSize: 11, color: '#c9a96e', marginTop: 6, textAlign: 'right' }}>
              查看 →
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

注意：`onOpenLetter` prop 在 MainLayout 连线之前为 undefined，气泡会显示但点击无跳转，Task 11 修复。

---

## Task 8: 新建 ReviewLetterListPage.jsx

**Files:**
- Create: `src/pages/ReviewLetterListPage.jsx`

- [ ] **Step 1: 创建文件**

```jsx
// src/pages/ReviewLetterListPage.jsx
// 回顾信列表页（从洞察页入口，独立页面，不占 Tab）
import { useState } from 'react'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ReviewLetterListPage({ letters = [], onBack, onOpenLetter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef', overflowY: 'auto' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14, marginRight: 12 }}>
          ← 返回
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>回顾信</span>
      </div>

      {/* 列表 */}
      <div style={{ padding: '16px 18px', flex: 1 }}>
        {letters.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
            暂无回顾信
          </div>
        ) : letters.map(letter => (
          <div key={letter.id}
            onClick={() => onOpenLetter(letter)}
            style={{
              background: 'white', borderRadius: 12, padding: '14px 16px',
              marginBottom: 12, cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              borderLeft: letter.is_read ? 'none' : '3px solid #c9a96e',
            }}>
            <div style={{ display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#888' }}>
                {formatDate(letter.created_at)}
                {letter.entry_ids?.length ? ` · ${letter.entry_ids.length}条记录` : ''}
              </span>
              {!letter.is_read && (
                <span style={{ width: 7, height: 7, borderRadius: '50%',
                  background: '#c9a96e', display: 'inline-block' }} />
              )}
            </div>
            <div style={{
              fontSize: 13, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {letter.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

---


## Task 9: 新建 ThreadsPage.jsx（脉络列表页）

**Files:**
- Create: `src/pages/ThreadsPage.jsx`

- [ ] **Step 1: 创建文件**

```jsx
// src/pages/ThreadsPage.jsx
// 脉络列表页：已确认 + 待确认 + 创建入口
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchThreads, createThread, updateThread, deleteThread } from '../lib/threadService'

export default function ThreadsPage({ onBack, onOpenThread }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCandidates, setShowCandidates] = useState(false)

  useEffect(() => {
    if (!user) return
    load()
  }, [user])

  async function load() {
    setLoading(true)
    const { data } = await fetchThreads(user.id)
    setThreads(data ?? [])
    setLoading(false)
  }

  async function handleCreate() {
    if (!newName.trim()) return
    const { data } = await createThread(user.id, { name: newName.trim(), status: 'confirmed' })
    if (data) setThreads(prev => [data, ...prev])
    setNewName('')
    setCreating(false)
  }

  async function handleConfirm(thread) {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  async function handleDelete(thread) {
    await deleteThread(thread.id, user.id)
    setThreads(prev => prev.filter(t => t.id !== thread.id))
  }

  const confirmed = threads.filter(t => t.status === 'confirmed')
  const candidates = threads.filter(t => t.status === 'candidate')

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack}
            style={{ background: 'none', border: 'none', color: '#bbb',
              cursor: 'pointer', fontSize: 14 }}>
            ← 返回
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>脉络</span>
        </div>
        <button onClick={() => setCreating(true)}
          style={{ fontSize: 12, color: '#c9a96e', background: 'none',
            border: 'none', cursor: 'pointer' }}>
          + 新建
        </button>
      </div>

      {/* 新建输入框 */}
      {creating && (
        <div style={{ padding: '12px 18px', background: '#faf8f4',
          borderBottom: '1px solid #ede9e2' }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
            placeholder="脉络名称，如：内心平静探索"
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            style={{
              width: '100%', border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 12px', fontSize: 13, outline: 'none',
              background: 'white', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setCreating(false); setNewName('') }}
              style={{ fontSize: 12, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer' }}>
              取消
            </button>
            <button onClick={handleCreate}
              style={{ fontSize: 12, color: '#c9a96e', background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 500 }}>
              创建
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* 已确认脉络 */}
        {confirmed.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>已确认</div>
            {confirmed.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenThread(thread)}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                  marginBottom: 10, cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                {thread.arc_summary && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.6,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {thread.arc_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 待确认（折叠） */}
        {candidates.length > 0 && (
          <div>
            <button
              onClick={() => setShowCandidates(v => !v)}
              style={{ fontSize: 11, color: '#aaa', background: 'none', border: 'none',
                cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              待确认（{candidates.length}）{showCandidates ? '▲' : '▼'}
            </button>
            {showCandidates && candidates.map(thread => (
              <div key={thread.id}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px',
                  marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  border: '1px dashed #e0dbd4' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500, marginBottom: 8 }}>
                  {thread.name}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => handleConfirm(thread)}
                    style={{ fontSize: 12, color: '#c9a96e', background: 'none',
                      border: '1px solid #f0e8d4', borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer' }}>
                    接受
                  </button>
                  <button onClick={() => handleDelete(thread)}
                    style={{ fontSize: 12, color: '#bbb', background: 'none',
                      border: '1px solid #e0dbd4', borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer' }}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {threads.length === 0 && !creating && (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
            暂无脉络，生成回顾信后 AI 会提议
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

---

## Task 10: 新建 ThreadDetailPage.jsx（脉络详情页）

**Files:**
- Create: `src/pages/ThreadDetailPage.jsx`

- [ ] **Step 1: 创建文件**

```jsx
// src/pages/ThreadDetailPage.jsx
// 脉络详情页：变化轨迹 + 关联记录列表
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchThreadWithEntries, updateThread, deleteThread, refreshArcSummary } from '../lib/threadService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadDetailPage({ thread: initialThread, onBack, onOpenEntry }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshingArc, setRefreshingArc] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    load()
  }, [initialThread.id])

  async function load() {
    setLoading(true)
    const { thread: t, entries: e } = await fetchThreadWithEntries(initialThread.id)
    if (t) setThread(t)
    setEntries(e.map(r => r.journal_entries).filter(Boolean)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
    setLoading(false)
  }

  async function handleRefreshArc() {
    setRefreshingArc(true)
    await refreshArcSummary(thread.id, user.id)
    const { thread: t } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setRefreshingArc(false)
  }

  async function handleNameSave() {
    if (!nameDraft.trim() || nameDraft === thread.name) { setEditingName(false); return }
    await updateThread(thread.id, user.id, { name: nameDraft.trim() })
    setThread(t => ({ ...t, name: nameDraft.trim() }))
    setEditingName(false)
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef', overflowY: 'auto' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14, marginRight: 12 }}>
          ← 返回
        </button>
        {editingName ? (
          <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            autoFocus
            onBlur={handleNameSave}
            onKeyDown={e => { if (e.key === 'Enter') handleNameSave() }}
            style={{ fontSize: 15, fontWeight: 600, border: '1px solid #e0dbd4',
              borderRadius: 6, padding: '2px 8px', outline: 'none', fontFamily: 'inherit' }}
          />
        ) : (
          <span
            onClick={() => { setNameDraft(thread.name); setEditingName(true) }}
            style={{ fontSize: 15, fontWeight: 600, color: '#333', cursor: 'pointer' }}>
            {thread.name}
          </span>
        )}
      </div>

      <div style={{ padding: '16px 18px' }}>

        {/* 变化轨迹 */}
        <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px',
          marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>变化轨迹</span>
            <button
              onClick={handleRefreshArc}
              disabled={refreshingArc || entries.length < 2}
              style={{ fontSize: 11, color: refreshingArc ? '#ccc' : '#c9a96e',
                background: 'none', border: 'none', cursor: 'pointer' }}>
              {refreshingArc ? '生成中…' : '✦ 更新'}
            </button>
          </div>
          {thread.arc_summary ? (
            <>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.8 }}>
                {thread.arc_summary}
              </div>
              {thread.arc_updated_at && (
                <div style={{ fontSize: 10, color: '#bbb', marginTop: 8 }}>
                  最后更新：{formatDate(thread.arc_updated_at)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
              {entries.length >= 2
                ? '点击「✦ 更新」生成变化轨迹'
                : '至少需要 2 条关联记录才能生成'}
            </div>
          )}
        </div>

        {/* 关联记录列表 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>
        {entries.map(entry => (
          <div key={entry.id}
            onClick={() => onOpenEntry(entry)}
            style={{ background: 'white', borderRadius: 10, padding: '10px 14px',
              marginBottom: 8, cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>
              {formatDate(entry.created_at)}
            </div>
            <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>
              {entry.entry_summary ?? '（暂无摘要）'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build 2>&1 | tail -10
```

---

## Task 11: MainLayout.jsx 连线所有新页面

**Files:**
- Modify: `src/components/MainLayout.jsx`

- [ ] **Step 1: 新增 import**

在 `MainLayout.jsx` 顶部 import 区追加：

```js
import ThreadsPage from '../pages/ThreadsPage'
import ThreadDetailPage from '../pages/ThreadDetailPage'
import ReviewLetterListPage from '../pages/ReviewLetterListPage'
```

- [ ] **Step 2: 新增导航函数**

在 `handleOpenLetter` 函数之后，追加：

```js
  // ── 洞察页 → 回顾信列表 ────────────────────────────────────────
  function handleOpenLetterList() {
    push({ type: 'letter_list' })
  }

  // ── 洞察页 → 脉络列表 ──────────────────────────────────────────
  function handleOpenThreads() {
    push({ type: 'threads' })
  }

  // ── 洞察页 / 脉络列表 → 脉络详情 ──────────────────────────────
  function handleOpenThread(thread) {
    push({ type: 'thread_detail', thread })
  }
```

- [ ] **Step 3: 在 renderScreen 里处理新屏幕类型**

找到 `renderScreen` 函数，在最后的 `return null` 之前追加：

```js
    if (screen.type === 'threads') {
      return (
        <ThreadsPage
          onBack={pop}
          onOpenThread={handleOpenThread}
        />
      )
    }

    if (screen.type === 'thread_detail') {
      return (
        <ThreadDetailPage
          thread={screen.thread}
          onBack={pop}
          onOpenEntry={entry => push({ type: 'detail', entry })}
        />
      )
    }

    if (screen.type === 'letter_list') {
      // allLetters 从 InsightsPage 数据里来；此处从 screens 带数据或重新查
      // 简化方案：让 ReviewLetterListPage 自己查，传 userId 即可
      return (
        <ReviewLetterListPage
          letters={screen.letters ?? []}
          onBack={pop}
          onOpenLetter={letter => push({ type: 'letter', letter })}
        />
      )
    }
```

- [ ] **Step 4: 把 allLetters 数据传入 letter_list 屏幕**

修改 `handleOpenLetterList` 函数，让它从 InsightsPage 的数据中获取（简化：让 ReviewLetterListPage 自己加载）：

```js
  // InsightsPage 加载完毕后会调此函数，附带 allLetters
  function handleOpenLetterList(letters = []) {
    push({ type: 'letter_list', letters })
  }
```

- [ ] **Step 5: 在 renderTab 里给 InsightsPage 传 navigation props**

找到 `case 'insights':`，改为：

```jsx
      case 'insights':
        return (
          <InsightsPage
            onOpenLetterList={handleOpenLetterList}
            onOpenThreads={handleOpenThreads}
            onOpenThread={handleOpenThread}
          />
        )
```

- [ ] **Step 6: 给 HomePage 传 onOpenLetter prop**

找到 `case 'write':`，改为：

```jsx
      case 'write':
        return (
          <HomePage
            onDone={handleHomeSaved}
            onOpenLetter={letter => push({ type: 'letter', letter })}
          />
        )
```

- [ ] **Step 7: 更新 InsightsPage 的 handleOpenLetterList 调用方式**

`InsightsPage.jsx` 里，`onOpenLetterList` 按钮触发时，需要把 `allLetters` 传过来：

```jsx
// 在 InsightsPage 的"查看全部 →"按钮：
onClick={() => onOpenLetterList?.(allLetters)}
```

- [ ] **Step 8: 验证编译**

```bash
npm run build 2>&1 | tail -20
```

预期：`✓ built in` 无报错。

- [ ] **Step 9: 手动全流程验证清单**

```bash
npm run dev
```

按顺序验证：
1. **洞察页** → 点「查看全部 →」→ 进入回顾信列表页 → 点一封信 → 进入 ReviewLetterDetail
2. **洞察页** → 点脉络「查看全部 →」→ 进入 ThreadsPage → 点一个脉络 → 进入 ThreadDetailPage
3. **ThreadDetailPage** → 点「✦ 更新」（至少 2 条关联记录时）→ 生成 arc_summary
4. **记录详情页** → 查看摘要索引区 → 点 ✎ 编辑 → 失焦保存
5. **写作页** → 若有未读回顾信，顶部出现气泡 → 停留 5 秒 → 气泡消失
6. **手动生成回顾信**（设置页 → 立即生成）→ 确认 covered_by_letter_id 写入（Supabase Dashboard 查询）

---

## 收尾

- [ ] **更新 arch-context.md §6 同步摘要日志**

```
2026-04-XX · 代码session · 完成第二批功能全量实现（Task 1-11）：
  - DB：journal_entries 新增 3 字段，新建 threads/thread_entries 表+RLS
  - reviewLetterService 重构：读 entry_summary/covered_by_letter_id 回写/负向排除
  - prompts.js 更新：回顾信 JSON 改为 suggested_threads
  - 新增：extractSummaryService / threadService 及测试
  - 新增页面：ThreadsPage / ThreadDetailPage / ReviewLetterListPage
  - RecordDetail：新增摘要索引区（EditableFieldRow）+ 🧵 脉络标签
  - HomePage：未读回顾信气泡 + 5秒自动标已读
  - MainLayout：连线所有新屏幕类型
```

- [ ] **跑全部测试**

```bash
node --test src/lib/extractSummaryService.test.js
node --test src/lib/threadService.test.js
node --test src/lib/awarenessFlowState.test.js
```

预期：全部 PASS。

- [ ] **最终 build 验证**

```bash
npm run build
```

- [ ] **用户确认后 git commit**

```bash
git add src/lib/extractSummaryService.js src/lib/extractSummaryService.test.js
git add src/lib/threadService.js src/lib/threadService.test.js
git add src/lib/prompts.js src/lib/reviewLetterService.js src/lib/insightsService.js
git add src/components/RecordDetail.jsx src/components/MainLayout.jsx
git add src/pages/InsightsPage.jsx src/pages/HomePage.jsx
git add src/pages/ThreadsPage.jsx src/pages/ThreadDetailPage.jsx src/pages/ReviewLetterListPage.jsx
git add docs/superpowers/plans/2026-04-11-threads-insights.md
git commit -m "feat: 实现第二阶段第二批功能 — threads/回顾信增强/洞察页/摘要索引"
```

---

*计划文档完成。*

---

## 自检补漏 Task 12: 修复 ReviewLetterListPage 自加载 + 记录页回顾信卡片

**Files:**
- Modify: `src/pages/ReviewLetterListPage.jsx`
- Modify: `src/pages/RecordsPage.jsx` （回顾信卡片样式：左侧橙色竖线，已由阶段二实现，此处确认无需改动）

### 12A: ReviewLetterListPage 改为自加载

- [ ] **Step 1: 修改 ReviewLetterListPage.jsx，支持自加载**

在文件顶部增加 import：

```js
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
```

将组件改为：

```jsx
export default function ReviewLetterListPage({ letters: initialLetters, onBack, onOpenLetter }) {
  const { user } = useAuth()
  const [letters, setLetters] = useState(initialLetters ?? [])
  const [loading, setLoading] = useState(!initialLetters?.length)

  useEffect(() => {
    // 若调用方未传 letters，自行查询
    if (initialLetters?.length) return
    if (!user) return
    async function load() {
      const { data } = await db.from('review_letters')
        .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setLetters(data ?? [])
      setLoading(false)
    }
    load()
  }, [user])

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  // ... 其余 JSX 保持不变（return 部分与 Task 8 Step 1 一致）
```

### 12B: 确认 RecordsPage 回顾信卡片样式

- [ ] **Step 2: 验证 RecordsPage 的回顾信卡片已有左侧橙色竖线**

打开 `src/pages/RecordsPage.jsx`，搜索 `review_letter` 或 `letter` 相关渲染，确认：
- 回顾信卡片有 `borderLeft: '3px solid #c9a96e'` 或类似样式
- 显示前两句正文截断（`WebkitLineClamp: 2` 或 `slice`）
- 有「阅读全文→」按钮触发 `onOpenLetter`

如已实现（阶段二代码），此步骤无需改动。若缺失，补上：

```jsx
// RecordsPage 中回顾信卡片的关键样式
style={{
  background: '#fffdf8',
  borderLeft: '3px solid #c9a96e',
  borderRadius: '0 12px 12px 0',
  padding: '12px 14px',
}}
```

### 12C: ThreadsPage 补充「查看已归档」入口

- [ ] **Step 3: 在 ThreadsPage 底部添加归档入口**

在 `ThreadsPage.jsx` 的列表区底部（`threads.length === 0` 提示之后），追加：

```jsx
        {/* 归档脉络入口 */}
        {threads.some(t => t.status === 'archived') && (
          <button
            onClick={() => setShowCandidates(false)  /* 复用折叠状态或另建 showArchived */}
            style={{ fontSize: 12, color: '#bbb', background: 'none', border: 'none',
              cursor: 'pointer', display: 'block', margin: '16px auto 0' }}>
            查看已归档
          </button>
        )}
```

（归档功能本批不完整实现，此入口仅视觉占位，完整归档状态切换在后续迭代实现。）

- [ ] **Step 4: 最终 build 验证**

```bash
npm run build 2>&1 | tail -10
```

---

*计划文档 — 自检补漏完成。*
