# 回顾信富内容改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让回顾信 AI 拿到用户真实写下的内容（日记原文 + 觉察卡片答案 + AI 对话回复），而不是经过压缩的摘要，解决信的内容过于概括、缺乏引用感的问题。

**Architecture:** 两处文件改动。`reviewLetterService.js` 扩展 DB 查询字段，将数据组装从 `{ date, entry_summary, theme_hints, core_needs }` 改为 `{ date, richContent }`（三段拼接：原文 + 卡片答案 + 对话用户消息）；`prompts.js` 更新 `getReviewLetterPrompt` 的 `entriesText` 构建逻辑和格式A判断规则（从代码词频统计改为 AI 语义判断）。`timeGreeting`、格式A/B 框架、`THREAD_OUTPUT_INSTRUCTION` 均保持不变。

**Tech Stack:** 纯 JS 字符串操作，Supabase 查询字段扩展，无新依赖

**注意：** Plan 1（时间问候 + 格式A/B）已执行完毕，本 plan 在其基础上继续。

---

## 文件改动地图

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/lib/reviewLetterService.js` | L63-64（首次查询） | 扩展 select 字段 |
| `src/lib/reviewLetterService.js` | L91-95（refreshed 查询） | 扩展 select 字段（与首次一致） |
| `src/lib/reviewLetterService.js` | L98-104（数据组装） | 改为 richContent 三段结构 |
| `src/lib/prompts.js` | L295-364（getReviewLetterPrompt） | entriesText 用 richContent；格式A规则改为 AI 判断 |

---

## Task 1：reviewLetterService.js — 扩展查询 + 改数据组装

**Files:**
- Modify: `src/lib/reviewLetterService.js`

### 背景

当前 L63 只查了 `id, entry_summary, theme_hints, core_needs, created_at`，AI 只能拿到摘要。需要加入 `content`（日记原文）、`full_conversation`（AI 对话）、以及觉察卡片字段 `current_thought, body_sensations, cognitive_analysis, reflection_insight`。

`needExtract`（L75）判断逻辑保持不变——仍以 `!e.entry_summary` 触发批量提取，因为提取过程同时填充觉察卡片字段，保证这些字段有内容。

- [ ] **Step 1：扩展首次查询（L63-64）**

找到：
```js
    .select('id, entry_summary, theme_hints, core_needs, created_at')
```

替换为：
```js
    .select('id, content, full_conversation, entry_summary, current_thought, body_sensations, core_needs, cognitive_analysis, reflection_insight, created_at')
```

- [ ] **Step 2：扩展 refreshed 查询（L91-92）**

找到：
```js
      .select('id, entry_summary, theme_hints, core_needs, created_at')
```

替换为：
```js
      .select('id, content, full_conversation, entry_summary, current_thought, body_sensations, core_needs, cognitive_analysis, reflection_insight, created_at')
```

- [ ] **Step 3：改数据组装为 richContent（L98-104）**

找到：
```js
  // Step 3: 构建摘要数组传 AI（不传原始 content）
  const entriesSummary = entries.map(e => ({
    date: e.created_at.slice(0, 10),
    entry_summary: e.entry_summary,
    theme_hints: e.theme_hints,
    core_needs: e.core_needs,
  }))
```

替换为：
```js
  // Step 3: 构建富内容数组传 AI（原文 + 觉察卡片答案 + 对话用户消息）
  const entriesSummary = entries.map(e => {
    const parts = []

    // ① 原始日记全文
    if (e.content) parts.push(`日记原文：\n${e.content}`)

    // ② 觉察卡片用户填写的答案（有值才加）
    const reflections = []
    if (e.current_thought)    reflections.push(`当下念头：${e.current_thought}`)
    if (e.body_sensations)    reflections.push(`身体感受：${e.body_sensations}`)
    if (e.core_needs?.length) reflections.push(`核心需求：${e.core_needs.join('、')}`)
    if (e.cognitive_analysis) reflections.push(`认知：${e.cognitive_analysis}`)
    if (e.reflection_insight) reflections.push(`洞见：${e.reflection_insight}`)
    if (reflections.length)   parts.push(reflections.join('\n'))

    // ③ AI 对话里用户真实说的话（跳过第 0 条——那条是系统自动发的日记原文）
    const userReplies = (e.full_conversation ?? [])
      .filter(m => m.role === 'user')
      .slice(1)
      .map(m => m.content)
      .filter(Boolean)
    if (userReplies.length) parts.push(`对话中说的：\n${userReplies.join('\n')}`)

    return {
      date: e.created_at.slice(0, 10),
      richContent: parts.join('\n\n'),
    }
  })
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "feat: 回顾信改用富内容（原文+觉察答案+对话）替代摘要字段"
```

---

## Task 2：prompts.js — 更新 entriesText 构建 + 格式A判断

**Files:**
- Modify: `src/lib/prompts.js:295-364`

### 背景

`getReviewLetterPrompt` 目前的 `entriesText` 用 `e.entry_summary, e.theme_hints, e.core_needs` 拼一行。Task 1 完成后这些字段不再传来，需改为 `e.richContent`。

格式A判断规则目前是字符串统计（`> ${entryCount} × 0.5`），依赖 `theme_hints/core_needs` 标签词频——没有标签时无法判断。改为让 AI 读完真实内容后自己判断，更准确也更简洁。

- [ ] **Step 1：修改 `entriesText` 构建逻辑**

找到（L295-302）：
```js
export function getReviewLetterPrompt({ entriesSummary, timeGreeting }) {
  // 每条条目拼为一行，theme_hints / core_needs 为空时省略对应片段
  const entriesText = entriesSummary.map((e, i) => {
    const parts = [`[${e.date.replace(/-/g, '/')}] 摘要：${e.entry_summary ?? '（无摘要）'}`]
    if (e.theme_hints?.length)  parts.push(`主题：${e.theme_hints.join('、')}`)
    if (e.core_needs?.length)   parts.push(`核心需求：${e.core_needs.join('、')}`)
    return parts.join(' | ')
  }).join('\n')
```

替换为：
```js
export function getReviewLetterPrompt({ entriesSummary, timeGreeting }) {
  // 每条条目用分隔线隔开，richContent 已包含原文 + 卡片答案 + 对话
  const entriesText = entriesSummary.map((e, i) =>
    `[第 ${i + 1} 条，${e.date.replace(/-/g, '/')}]\n${e.richContent}`
  ).join('\n\n---\n\n')
```

- [ ] **Step 2：修改格式A判断规则**

找到（L308-320）：
```js
  return `你会收到用户最近 ${entryCount} 条日记摘要（${dateRange}）。请先选择写信格式，再按该格式写信。

---

## 第一步：选择格式

读完所有条目后，按以下规则选格式：

**格式A（一根线）——满足任一条件即选格式A：**
- theme_hints、core_needs 或摘要文字中，同一个词出现在超过一半的条目中（严格 >50%，即出现次数 > ${entryCount} × 0.5）
- 同一个词出现在 5 条或更多条目中

**否则选格式B（关键时刻）。**
```

替换为：
```js
  return `你会收到用户最近 ${entryCount} 条日记记录（${dateRange}）。请先选择写信格式，再按该格式写信。

---

## 第一步：选择格式

读完所有条目，凭感受判断：
- 如果你发现同一种感受、同一个处境、或同一个词反复在不同条目里出现——选格式A（一根线）
- 否则选格式B（关键时刻）

```

- [ ] **Step 3：更新结尾的"日记摘要"为"日记记录"**

找到（L361）：
```js
以下是用户的日记摘要（${entryCount} 条，${dateRange}）：
```

替换为：
```js
以下是用户的日记记录（${entryCount} 条，${dateRange}）：
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/lib/prompts.js
git commit -m "feat: 回顾信 prompt 改用 richContent，格式A/B 改为 AI 语义判断"
```

---

## Task 3：本地验收

```bash
npm run dev
```

**验收清单：**

1. 进入设置页，手动生成一封回顾信，观察信的内容是否引用了原始日记里的具体词句（不是泛泛的摘要语言）
2. 若有觉察卡片答案，信里应能看到「当下念头」「洞见」等字段的原话被引用
3. 信的开头有时间问候词（早/中/晚/深夜）
4. 信的末尾有 `suggested_threads` JSON，详情页正常渲染脉络卡片
5. 没有写过觉察卡片的条目，信仍然正常生成（只用日记原文）
6. 控制台无报错
