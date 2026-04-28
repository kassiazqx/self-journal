# 同步卡：P3 提取上下文统一

**状态：** 代码已完成，SQL 审计/回填/删列已完成，待剩余手工验证  
**日期：** 2026-04-28  
**commit：** `2c2ce77` `refactor(ai): unify extraction context`  
**分支：** `dev`

---

## 目标

按：

- `docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md`
- `docs/superpowers/plans/2026-04-27-p3-extraction-context-unification.md`

只做 P3 提取链收口，不改 P0/P1 架构方向，不恢复“保存即自动提取”。

---

## 最终决策

### 1. 共享文本构建层正式落地

新增 `src/lib/entryFullText.js`，统一提供四个 builder：

- `buildEntryFullText()`：原始写作 + 本地问题/回答 + AI 问答
- `buildConversationMessageIndex()`：`conversations` 行转 `entry_id -> messages` 映射
- `buildMemoryConversationText()`：按 `nodeType` 精确映射记忆更新文本
- `buildReviewLetterRichContent()`：共享 fullText + 结构化补充字段

### 1.1 reviewer follow-up：answered-turn normalization

- `entryFullText.js` 后续补了一层 answered-turn normalization
- 现在只保留成对的：
  - `local_prompt + local_answer`
  - `ai_prompt + ai_answer`
- 草稿态的 prompt-only 对话不再进入：
  - `buildEntryFullText()`
  - `buildMemoryConversationText()`
  - `buildReviewLetterRichContent()`

### 2. 单条提取只保留 RecordDetail 手动入口

- 新增 `src/lib/entryExtractionService.js`
- `RecordDetail.handleAIAnalyze()` 改为：
  - 先用 `buildEntryFullText({ entry, messages })`
  - 再调 `extractEntryFields(fullText, { userId })`
- 不再依赖 `conversationService.extractFields()`

### 3. 批量提取改吃完整 fullText

- `extractSummaryService` 现在先查：
  - `journal_entries`
  - `conversations(entry_id, messages)`
- 再为每条 entry 生成 `fullText`
- `buildSummaryPrompt()` 优先读取 `entry.fullText`

### 4. 回顾信和记忆都切到 conversations 主路径

- `reviewLetterService` 不再读取 `full_conversation`
- 回顾信用 `buildReviewLetterRichContent()` 组装富内容
- 新增 `src/lib/conversationMemoryService.js`
- `SettingsPage.handleForceUpdateMemory()` 直接读取最近一条 `conversations.messages`
- reviewer follow-up 后，`SettingsPage` 不再 `limit(1)` 硬拿最新一条；改为回看最近 10 条，取最新一条“有有效回答”的 conversation
- 若 conversations 查询失败，`SettingsPage` 直接报错，不再伪装成“最近没有可用于更新记忆的已回答对话”
- `reviewLetterService` 读取 conversations 失败时 fail closed，不生成正式回顾信，也不消耗 entry

### 5. 旧自动链已从运行时代码移除

已删除：

- `src/components/AIConversation.jsx`
- `src/lib/conversationService.js`

已移除：

- `memory.js` 中的 `incrementConversationCount()`

数据库收尾：

- `journal_entries.full_conversation` 已完成审计后删列
- 当前 entry 对话链只剩 `conversations`

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/entryFullText.js` | 新建共享 fullText / memory / review-letter builder |
| `src/lib/entryFullText.test.js` | 新增 builder 测试；follow-up 补 answered-turn / 跳过草稿用例 |
| `src/lib/entryExtractionService.js` | 新建单条 AI 提取服务 |
| `src/lib/extractSummaryService.js` | 批量提取改查 `conversations` 并使用 `fullText` |
| `src/lib/extractSummaryService.test.js` | 补 `fullText` 新用例 |
| `src/lib/conversationMemoryService.js` | 新建手动记忆更新服务 |
| `src/components/RecordDetail.jsx` | 手动 AI 分析改走共享 fullText + 新提取 service |
| `src/lib/reviewLetterService.js` | 回顾信富内容改走 `conversations` 主路径；follow-up 补 conversations 查询 fail-closed |
| `src/pages/SettingsPage.jsx` | 手动更新记忆改查最近 `conversations.messages`；follow-up 改为最近 10 条中选最新有效回答对话，并区分查询失败 vs 无数据 |
| `src/lib/memory.js` | 删除 `incrementConversationCount()` |
| `src/lib/prompts.js` | 更新字段同步注释口径 |
| `docs/arch-context.md` | 更新 §3 真实结构、§6 日志 |
| `docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md` | 更新 P3 状态 |
| Supabase SQL | 审计 `legacy_only_count`、回填旧数据、删除 `full_conversation` 列 |

---

## 自动验证

已执行：

- `node --test src/lib/entryFullText.test.js`
- `node --test src/lib/entryFullText.test.js src/lib/extractSummaryService.test.js`
- `node --test src/lib/entryFullText.test.js src/lib/extractSummaryService.test.js src/lib/entrySnapshots.test.js src/store/entrySlice.test.js`
- `npm run lint`
- `npm run build`

结果：

- `node --test` 通过
- 15/15 tests 通过
- `lint` 通过
- `build` 通过
- 构建仍有既有 Vite chunk size warning，不是本轮新增问题

---

## 待手工验证

- RecordDetail 打开一条已有 `conversations` 的记录，点 `AI 分析` 后字段正常回填
- RecordDetail 打开一条只有原文、没有对话的记录，点 `AI 分析` 后仍可提取
- Settings 页点“更新记忆”后：
  - 最新一条若只是草稿 prompt，不应误报成功
  - 最近 10 条里若有更早的有效回答对话，仍应成功更新
  - 若最近都没有有效回答，应显示“最近没有可用于更新记忆的已回答对话”
- 生成回顾信前，缺摘要的记录仍会被批量补提取
- 新生成的回顾信正文里能看到对话上下文，不丢后续手动修订字段

---

## SQL 审计结果

### 1. 先查 `legacy_only_count`

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

### 2. 若 `legacy_only_count > 0`，先回填

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

### 3. 只有审计确认后才删列

```sql
ALTER TABLE journal_entries
DROP COLUMN IF EXISTS full_conversation;
```

实际执行结果：

- `legacy_only_count = 9`
- 已执行回填 SQL
- 回填后 `legacy_only_count = 0`
- 已执行 `ALTER TABLE journal_entries DROP COLUMN IF EXISTS full_conversation`

---

## 残余风险

- `entryExtractionService` 仍保留“新用户自动 seed 默认 category 标签”的旧行为；这是为了避免提取侧回归，不影响本轮 P3 架构方向
- AI 输出质量（摘要/情绪/需求/记忆）要在真实手测后再评估，当前只能确认输入链已统一
