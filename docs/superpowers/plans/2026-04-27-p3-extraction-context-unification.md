# P3 Extraction Context Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 entry 提取的触发口径与 fullText 数据源，只保留“手动提取 + 回顾信前批量提取”两种模式，清理 `AIConversation` / `full_conversation` 旧链，并把不可逆删列动作后移到审计确认之后。

**Architecture:** 新建一个共享的 entry 文本构建层，正式数据源只读 `journal_entries + conversations.messages`。`RecordDetail` 手动提取、`extractSummaryService` 批量补提取、`reviewLetterService` 富内容构建、`SettingsPage` 记忆更新都复用它，但各自使用明确分工的 builder：提取用 `fullText`、记忆更新用 `memoryConversationText`、回顾信用 `reviewLetterRichContent`。旧的 `AIConversation.saveConversation() -> _backgroundProcess` 自动提取链和运行时代码里的 `full_conversation` 读取链在替换完调用后删除；DB 列清理单列为审计后的 gated cleanup。

**Tech Stack:** React, Supabase via `db.js`, existing `entryRepository`, `node:test`, manual SQL for column cleanup

---

## Scope

- 做：
  - 统一提取触发口径为两种：手动提取、回顾信前批量提取
  - 统一 fullText 规则：原文 + 题目原文 + 用户回答 + AI 问答
  - 所有需要“理解这条记录”的读取都改走 `conversations` 主路径
  - 清理 `AIConversation` / `conversationService.saveConversation` / `full_conversation` 运行时残余依赖
  - 审计旧 `full_conversation` 历史数据，并把删列动作后移到确认后
- 不做：
  - 提示词内容优化
  - AI 字段质量调参
  - 删除统一语义
  - 安卓语音

## Hard Rules

- 不再恢复“保存即自动提取”
- `conversations` 是 entry 对话主路径；`full_conversation` 只允许出现在删除步骤之前的迁移代码里
- fullText 必须保留题目原文；不能只拼用户回答
- 记忆更新文本不能按 `role === 'user' ? 我 : AI` 粗暴二分，必须按 `nodeType` 精确映射
- 回顾信富内容不能只剩共享 fullText，必须保留用户后续手动修订过的结构化字段补充
- 没有审计结果和用户确认，不执行 `DROP COLUMN full_conversation`
- 所有 DB 访问继续走 `db.js`

## Files

- Create: `src/lib/entryFullText.js`
- Create: `src/lib/entryFullText.test.js`
- Create: `src/lib/entryExtractionService.js`
- Create: `src/lib/conversationMemoryService.js`
- Modify: `src/components/RecordDetail.jsx`
- Modify: `src/lib/extractSummaryService.js`
- Modify: `src/lib/reviewLetterService.js`
- Modify: `src/pages/SettingsPage.jsx`
- Modify: `src/lib/memory.js`
- Modify: `src/lib/prompts.js`
- Delete: `src/components/AIConversation.jsx`
- Delete: `src/lib/conversationService.js`
- Docs: `docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md`
- Docs: `docs/arch-context.md`
- Docs: `docs/sync-cards/2026-04-27-p3-extraction-context-unification.md`

### Task 1: 建立共享 fullText 构建层

**Files:**
- Create: `src/lib/entryFullText.js`
- Test: `src/lib/entryFullText.test.js`

- [ ] **Step 1: 写失败测试，锁定 fullText 格式**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEntryFullText } from './entryFullText.js'

test('buildEntryFullText keeps prompts and answers in order', () => {
  const entry = { content: '今天很乱。' }
  const messages = [
    { nodeType: 'raw_entry', content: '今天很乱。' },
    { nodeType: 'local_prompt', content: '这件事里，哪个时刻最深？' },
    { nodeType: 'local_answer', content: '被催的时候。' },
    { nodeType: 'ai_prompt', content: '那一刻你心里最在意什么？' },
    { nodeType: 'ai_answer', content: '怕自己做不好。' },
  ]

  const fullText = buildEntryFullText({ entry, messages })

  assert.match(fullText, /原始写作：\n今天很乱。/)
  assert.match(fullText, /本地问题：这件事里，哪个时刻最深？/)
  assert.match(fullText, /我的回答：被催的时候。/)
  assert.match(fullText, /AI问题：那一刻你心里最在意什么？/)
  assert.match(fullText, /我的回答：怕自己做不好。/)
})
```

- [ ] **Step 2: 跑测试，确认当前失败**

Run: `node --test src/lib/entryFullText.test.js`

Expected: FAIL with `Cannot find module './entryFullText.js'`

- [ ] **Step 3: 写最小实现**

```js
export function buildEntryFullText({ entry, messages = [] }) {
  const parts = []
  const raw = entry?.content ?? ''

  if (raw) {
    parts.push(`原始写作：\n${raw}`)
  }

  for (const message of messages) {
    if (!message?.content?.trim()) continue
    if (message.nodeType === 'raw_entry') continue
    if (message.nodeType === 'local_prompt') parts.push(`本地问题：${message.content.trim()}`)
    if (message.nodeType === 'local_answer') parts.push(`我的回答：${message.content.trim()}`)
    if (message.nodeType === 'ai_prompt') parts.push(`AI问题：${message.content.trim()}`)
    if (message.nodeType === 'ai_answer') parts.push(`我的回答：${message.content.trim()}`)
  }

  return parts.join('\n\n')
}
```

- [ ] **Step 4: 补三个辅助函数，分别给批量提取、记忆、回顾信复用**

```js
export function buildConversationMessageIndex(rows = []) {
  return new Map(rows.map(row => [row.entry_id, row.messages ?? []]))
}

export function buildMemoryConversationText(messages = []) {
  return messages
    .filter(Boolean)
    .filter(m => m.nodeType !== 'raw_entry')
    .map((message) => {
      if (message.nodeType === 'local_prompt') return `本地问题：${message.content}`
      if (message.nodeType === 'local_answer') return `我的回答：${message.content}`
      if (message.nodeType === 'ai_prompt') return `AI问题：${message.content}`
      if (message.nodeType === 'ai_answer') return `我的回答：${message.content}`
      return null
    })
    .filter(Boolean)
    .join('\n\n')
}

export function buildReviewLetterRichContent({ entry, messages = [] }) {
  const parts = [buildEntryFullText({ entry, messages })]
  const supplements = []

  if (entry.current_thought) supplements.push(`当下念头：${entry.current_thought}`)
  if (entry.body_sensations) supplements.push(`身体感受：${entry.body_sensations}`)
  if (entry.core_needs?.length) supplements.push(`核心需求：${entry.core_needs.join('、')}`)
  if (entry.cognitive_analysis) supplements.push(`认知：${entry.cognitive_analysis}`)
  if (entry.reflection_insight) supplements.push(`洞见：${entry.reflection_insight}`)

  if (supplements.length > 0) {
    parts.push(`后续整理字段：\n${supplements.join('\n')}`)
  }

  return parts.filter(Boolean).join('\n\n')
}
```

- [ ] **Step 5: 再跑测试**

Run: `node --test src/lib/entryFullText.test.js`

Expected: PASS

### Task 2: 抽出单条提取 service，切掉旧自动提取语义

**Files:**
- Create: `src/lib/entryExtractionService.js`
- Modify: `src/components/RecordDetail.jsx`
- Modify: `src/lib/prompts.js`

- [ ] **Step 1: 从旧 `conversationService.js` 提取单条提取函数**

```js
// src/lib/entryExtractionService.js
import { callAI } from './aiClient'
import { db } from './db'
import { getExtractionPrompt } from './prompts'

async function getUserCategoryTags(userId) {
  const { data } = await db.from('user_options')
    .select('option_value')
    .eq('user_id', userId)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })
  return (data ?? []).map(r => r.option_value)
}

async function getUserCoreNeeds(userId) {
  const { data } = await db.from('user_options')
    .select('option_value')
    .eq('user_id', userId)
    .eq('field_name', 'core_need')
    .order('sort_order', { ascending: true })
  return (data ?? []).map(r => r.option_value)
}

export async function extractEntryFields(fullText, { userId } = {}) {
  const [userCategoryTags, userCoreNeeds] = await Promise.all([
    userId ? getUserCategoryTags(userId) : Promise.resolve([]),
    userId ? getUserCoreNeeds(userId) : Promise.resolve([]),
  ])

  const prompt = `以下是用户这条记录的完整内容：\n\n${fullText}\n\n${getExtractionPrompt(userCategoryTags, userCoreNeeds)}`
  const raw = await callAI(
    [{ role: 'user', content: prompt }],
    '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
    { maxTokens: 1200 },
  )

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return {}

  try {
    return JSON.parse(match[0])
  } catch {
    return {}
  }
}
```

- [ ] **Step 2: `RecordDetail` 改用共享 fullText builder**

```js
import { buildEntryFullText } from '../lib/entryFullText'
import { extractEntryFields } from '../lib/entryExtractionService'

const fullText = buildEntryFullText({ entry, messages })
const extraction = await extractEntryFields(fullText, { userId: user.id })
```

- [ ] **Step 3: 删掉 `prompts.js` 里对 `AIConversation.jsx finishAndSave()` 的同步注释**

```js
// 新注释目标：
// 1. 本文件里的 JSON 字段列表
// 2. entryExtractionService / extractSummaryService 的写回字段列表
// 3. supabase schema / 手工 SQL 文档
```

- [ ] **Step 4: 验证手动提取仍可工作**

Run: `npm run build`

Expected: build passes

### Task 3: 批量提取改吃完整 fullText

**Files:**
- Modify: `src/lib/extractSummaryService.js`
- Modify: `src/lib/entryFullText.js`
- Test: `src/lib/extractSummaryService.test.js`

- [ ] **Step 1: 先读现有 `extractSummaryService.test.js`，确认内联实现和旧用例**

Run: `sed -n '1,260p' src/lib/extractSummaryService.test.js`

Expected: 能看到当前测试文件使用了“内联同款实现”，不是直接 import 真函数

- [ ] **Step 2: 先把测试文件里的内联 helper 签名同步到生产函数，再保留旧用例并补 fullText 新用例**

```js
// 在测试文件现有的内联 helper 里同步两处：
// 1. 函数签名改成 buildSummaryPrompt(entries, vocabOptions = {})
// 2. entriesText 从只读 e.content 改成优先读 e.fullText
const entriesText = entries.map((e, i) =>
  `[条目${i + 1}，id: ${e.id}]\n${e.fullText ?? e.content ?? ''}`
).join('\n\n---\n\n')

// 保留现有 3 个测试：
// 1. returns a string containing the content
// 2. handles empty entries gracefully
// 3. each entry is labeled with index and id

test('buildSummaryPrompt uses entry fullText instead of raw content only', () => {
  const prompt = buildSummaryPrompt([
    { id: 'e1', content: 'A', fullText: '原始写作：\\nA\\n\\n本地问题：Q\\n\\n我的回答：B' },
  ], {})
  assert.match(prompt, /本地问题：Q/)
  assert.match(prompt, /我的回答：B/)
})
```

- [ ] **Step 3: 在 `extractBatch()` 里连带查 `conversations`**

```js
const { data: entries } = await db.from('journal_entries')
  .select('id, content, entry_summary, emotions, core_needs, category_tags, people_involved')
  .eq('user_id', userId)
  .in('id', entryIds)

const { data: rows } = await db.from('conversations')
  .select('entry_id, messages')
  .eq('context_type', 'entry')
  .in('entry_id', entryIds)

const messageIndex = buildConversationMessageIndex(rows ?? [])
const enrichedEntries = entries.map(entry => ({
  ...entry,
  fullText: buildEntryFullText({
    entry,
    messages: messageIndex.get(entry.id) ?? [],
  }),
}))

const prompt = buildSummaryPrompt(enrichedEntries, vocabOptions)
```

- [ ] **Step 4: `buildSummaryPrompt()` 改读 `fullText`**

```js
const entriesText = entries.map((e, i) =>
  `[条目${i + 1}，id: ${e.id}]\n${e.fullText ?? e.content ?? ''}`
).join('\n\n---\n\n')
```

- [ ] **Step 5: 跑提取相关测试**

Run: `node --test src/lib/entryFullText.test.js src/lib/extractSummaryService.test.js`

Expected: PASS

### Task 4: 回顾信与记忆都切到 conversations 主路径，并先迁出记忆 service

**Files:**
- Create: `src/lib/conversationMemoryService.js`
- Modify: `src/lib/reviewLetterService.js`
- Modify: `src/pages/SettingsPage.jsx`
- Modify: `src/lib/entryFullText.js`

- [ ] **Step 1: `reviewLetterService` 取消 `full_conversation` 读取**

```js
const { data: entries } = await db.from('journal_entries')
  .select('id, content, entry_summary, current_thought, body_sensations, core_needs, cognitive_analysis, reflection_insight, created_at')
  .eq('user_id', userId)
  .is('covered_by_letter_id', null)
  .neq('template_type', 'freewrite')
  .order('created_at', { ascending: true })
  .limit(8)

const { data: rows } = await db.from('conversations')
  .select('entry_id, messages')
  .eq('context_type', 'entry')
  .in('entry_id', entries.map(e => e.id))
```

- [ ] **Step 2: 回顾信富内容改用专门 builder，保留结构化补充**

```js
const messageIndex = buildConversationMessageIndex(rows ?? [])
const entriesSummary = entries.map(entry => ({
  date: entry.created_at.slice(0, 10),
  richContent: buildReviewLetterRichContent({
    entry,
    messages: messageIndex.get(entry.id) ?? [],
  }),
}))
```

- [ ] **Step 3: 先创建 `conversationMemoryService.js`，让记忆更新脱离旧 `conversationService.js`**

```js
// src/lib/conversationMemoryService.js
import { callAI } from './aiClient'
import { buildMemoryConversationText } from './entryFullText'
import { getMemoryUpdatePrompt } from './prompts'
import { updateMemory, resetConversationCount } from './memory'

export async function forceUpdateMemory({ messages = [] } = {}) {
  const convoText = buildMemoryConversationText(messages)

  if (!convoText) {
    await resetConversationCount()
    return { error: null }
  }

  try {
    const raw = await callAI(
      [{ role: 'user', content: getMemoryUpdatePrompt(convoText) }],
      '你是用户记忆整理助手，只返回纯 JSON，不加任何说明或 markdown。',
      { maxTokens: 600 },
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const { rolling_summary, user_profile } = JSON.parse(match[0])
      await updateMemory({ rolling_summary, user_profile })
    }
    await resetConversationCount()
    return { error: null }
  } catch (error) {
    return { error }
  }
}
```

- [ ] **Step 4: Settings 记忆更新不再扫 `full_conversation`，直接把最新 `messages` 交给新 service**

```js
const { data: rows } = await db.from('conversations')
  .select('entry_id, updated_at, messages')
  .eq('context_type', 'entry')
  .order('updated_at', { ascending: false })
  .limit(1)

const { error } = await forceUpdateMemory({ messages: rows?.[0]?.messages ?? [] })
```

- [ ] **Step 5: 跑 build，确认 `reviewLetterService` / `SettingsPage` 已切到 `conversations` 主路径**

Run: `npm run build`

Expected: PASS

### Task 5: 删除旧链并收文档

**Files:**
- Delete: `src/components/AIConversation.jsx`
- Delete: `src/lib/conversationService.js`
- Modify: `src/lib/memory.js`
- Docs: `docs/arch-context.md`
- Docs: `docs/sync-cards/2026-04-27-p3-extraction-context-unification.md`

- [ ] **Step 1: 先自验零调用/仅旧链调用，再删旧文件**

Run:

```bash
rg -n "AIConversation" src
rg -n "saveConversation\\(|incrementConversationCount" src
```

Expected:
- `AIConversation` only 命中 `src/components/AIConversation.jsx`
- `saveConversation(` only 命中 `src/lib/conversationService.js`
- `incrementConversationCount` only 命中 `src/lib/conversationService.js` 和 `src/lib/memory.js`

- [ ] **Step 2: 确认 Task 4 已迁出 `forceUpdateMemory` 后，再删除 `conversationService.js` 与 `incrementConversationCount()`**

```js
// Task 4 完成后，这里应该只剩旧自动链：
// 1. saveConversation()
// 2. _backgroundProcess()
// 3. extractFields() 若已迁到 entryExtractionService.js，也一并删除旧 export

// src/lib/memory.js
// 删除 incrementConversationCount()
// 保留 getMemory / updateMemory / resetConversationCount()
```

若 Step 1 grep 发现额外调用方，先改调用方，再删旧文件；不能直接按计划删除。

- [ ] **Step 3: 更新文档口径，但不在本任务默认执行删列**

```md
- `conversations` 是唯一 entry 对话主路径
- `full_conversation` 已从运行时代码移除，但 DB 列清理需审计后单独确认
- 提取只保留两种触发：手动、回顾信前批量
```

- [ ] **Step 4: 全量验证**

Run:

```bash
node --test src/lib/entryFullText.test.js src/lib/extractSummaryService.test.js src/lib/entrySnapshots.test.js src/store/entrySlice.test.js
npm run lint
npm run build
rg -n "full_conversation|AIConversation|saveConversation\\(" src docs
rg -n "incrementConversationCount" src docs
```

Expected:
- tests pass
- lint passes
- build passes
- `rg` 显示 `src/` 不再有运行时代码引用；`docs/` 中允许保留历史记录

### Task 6: 审计旧 `full_conversation` 数据，并把删列改成 gated cleanup

**Files:**
- Docs: `docs/sync-cards/2026-04-27-p3-extraction-context-unification.md`
- Manual SQL: 用户确认后在 Supabase 执行

- [ ] **Step 1: 先审计旧数据是否仍有独占内容**

```sql
SELECT COUNT(*) AS legacy_only_count
FROM journal_entries e
WHERE e.full_conversation IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM conversations c
    WHERE c.entry_id = e.id
      AND c.context_type = 'entry'
  );
```

- [ ] **Step 2: 若 `legacy_only_count > 0`，先用幂等 SQL 回填再考虑删列**

```sql
INSERT INTO conversations (user_id, entry_id, context_type, messages, updated_at)
SELECT e.user_id, e.id, 'entry', e.full_conversation, COALESCE(e.updated_at, e.created_at, NOW())
FROM journal_entries e
WHERE e.full_conversation IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM conversations c
    WHERE c.entry_id = e.id
      AND c.context_type = 'entry'
  )
ON CONFLICT (entry_id, context_type) DO NOTHING;
```

- [ ] **Step 3: 只有在“legacy_only_count = 0”或“已完成回填”或“用户明确接受丢弃旧数据”后，才执行删列**

```sql
ALTER TABLE journal_entries
DROP COLUMN IF EXISTS full_conversation;
```

- [ ] **Step 4: 在同步卡里明确记录审计结果和最终决定**

```md
- legacy_only_count = X
- 是否执行回填：是 / 否
- 是否执行删列：是 / 否
```

## Done Definition

- 提取正式口径只剩两种：手动、回顾信前批量
- `conversations` 成为唯一 entry 对话主路径
- 单条提取、批量提取、回顾信富内容、记忆更新都基于共享文本构建层，但各自用明确 builder
- `AIConversation` / `full_conversation` 旧链从运行时代码中移除
- `incrementConversationCount` 随自动链一起移除
- `full_conversation` DB 列只在审计和确认后再清理
- 总方案、架构文档、同步卡口径一致
