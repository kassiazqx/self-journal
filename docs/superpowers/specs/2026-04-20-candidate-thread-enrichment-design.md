# 候选脉络信息补全设计文档

> 版本：2026-04-20

---

## §0 背景

回顾信生成时，AI 会建议新建候选脉络（`suggested_threads`），目前只存了脉络名称，导致候选脉络页面：

- 来源标签显示"手动分析"（`trigger_source` 字段缺失）
- 发现理由为空（`arc_summary` 字段缺失）
- 关联记录为 0（未创建 `thread_entries` 行）

用户进入候选脉络后无法判断这条脉络从哪来、为什么被 AI 发现，影响"接受/忽略"决策质量。

---

## §1 目标效果

候选脉络详情页展示：

| 字段 | 改前 | 改后 |
|---|---|---|
| 来源标签 | 手动分析 · 4月18日 | 回顾信触发 · 4月18日 |
| AI 发现理由 | AI 尚未生成发现理由 | 2-3句话说明 AI 为什么注意到这条模式 |
| 关联记录 | （0） | 具体日记条目卡片，可点击查看 |

---

## §2 方案

**同一次 AI 调用**。在现有的回顾信生成 prompt 中扩展 JSON schema，让 AI 在同一次响应里返回发现理由和关联条目序号，不额外调用 AI。

---

## §3 数据层改动

### 3.0 数据库迁移（Task 0，必须先执行，阻塞实现）

在 Supabase SQL Editor 执行：

```sql
ALTER TABLE threads ADD COLUMN trigger_source text;
```

> ⚠️ trigger_source 不在当前 threads 表结构中。不执行此迁移，代码 session insert({ trigger_source: 'review', ... }) 会报 `column does not exist` 错误，整条 thread 创建失败。

### 3.1 JSON schema 扩展（`prompts.js`）

`getReviewLetterPrompt` 末尾的 JSON schema 改为：

```json
{
  "suggested_threads": [
    {
      "action": "create",
      "thread_id": null,
      "thread_name": "脉络名称",
      "discovery_reason": "2-3句话说明AI为什么注意到这条模式，引用用户自己写的词或场景",
      "related_entry_indices": [0, 2]
    }
  ]
}
```

字段说明：
- `discovery_reason`：AI 的发现理由，2-3句，引用用户原文中的词汇和场景，不泛泛而谈
- `related_entry_indices`：本次分析的 entries 数组里触发这条脉络的条目序号（0-based）

prompt 里需说明：`related_entry_indices` 填的是上方日记摘要数组的序号（第0条 = 第1篇日记），可填多个。

### 3.2 threads 表新字段

插入候选脉络时新增：

| 字段 | 值 | 说明 |
|---|---|---|
| `trigger_source` | `'review'` | 标识来源，CandidateDetailPage 用此字段判断标签 |
| `arc_summary` | AI 返回的 `discovery_reason` | 发现理由 |
| `arc_updated_at` | `new Date().toISOString()` | 与 threadService.js 写 arc_summary 的模式保持一致 |

### 3.3 thread_entries 新增行

每条候选脉络创建后，根据 `related_entry_indices` 写入对应的 `thread_entries`：

| 字段 | 值 |
|---|---|
| `thread_id` | 新建脉络的 id |
| `entry_id` | `entries[index].id` |
| `added_by` | `'ai'` |
| `removed_by_user` | `false` |

---

## §4 逻辑层改动（`reviewLetterService.js`）

### 现状

Step 7 使用 `Promise.all` 并行 insert，不取回 thread id，无法写 `thread_entries`：

```js
await Promise.all(
  toCreate.map(t =>
    db.from('threads').insert({
      user_id: userId,
      name: t.thread_name.trim(),
      status: 'candidate',
    })
  )
)
```

### 改后

改为串行循环（顺序不影响业务，每条脉络独立），每次 insert 后取回 id 再写 `thread_entries`：

```
for each t in toCreate:
  1. insert thread → select id back
  2. compute related entry ids:
       const relatedEntryIds = (t.related_entry_indices ?? [])
         .filter(i => i >= 0 && i < entries.length)  // 过滤越界
         .map(i => entries[i].id)                     // entries 与 prompt 传入的同一批对象，index 对齐
  3. if relatedEntryIds.length > 0: batch insert thread_entries
```

**错误处理：**
- thread INSERT 失败 → console.error，跳过这一条，继续串行循环下一条（thread 未创建，无中间态）
- thread_entries INSERT 失败 → console.error，不抛出，thread 已创建，用户接受后可通过 AI 召回补关联

---

## §5 不涉及范围

- `CandidateDetailPage.jsx` 不改动：已有 `arc_summary` 和 `thread_entries` 展示逻辑，字段补齐后自动生效
- `link` action（回顾信 AI 建议将新 entries 关联到已有脉络）**本次明确不处理**：需要向 prompt 注入已有脉络列表，有 token 增长和 hallucination 风险，已有脉络的关联更新靠用户在脉络详情页手动触发"重新分析"
- 已存在的候选脉络不做回填
- 批量刷新已有脉络入口不在本次范围内

---

## §6 成功验收标准

1. 生成回顾信后，候选脉络页来源标签显示"回顾信触发 · [日期]"
2. 候选脉络详情页"AI 发现理由"区域显示 2-3 句非空文字，引用用户原文词汇
3. 候选脉络详情页关联记录 > 1，卡片显示对应日记摘要和日期
4. 接受/忽略候选脉络功能不受影响
5. `thread_entries` 写入失败时不影响脉络创建（静默降级）
