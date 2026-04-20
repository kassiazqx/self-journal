# 同步卡：候选脉络信息补全 · 代码 Session

> **代码 session 冷启动必读。按顺序读完再动手。**
> **状态：⏳ 待实现**

---

## 一、必读文档

| 文档 | 说明 |
|---|---|
| `docs/arch-context.md` §4.36 | threads 表需新增 trigger_source 列，不迁移会报错 |
| `docs/arch-context.md` §4.37 | Step 7 改为串行循环的原因 + entries index 对齐规则 |
| `docs/arch-context.md` §5.8 | review_letters.insights JSONB 版本兼容策略 |
| `docs/superpowers/specs/2026-04-20-candidate-thread-enrichment-design.md` | 完整功能 spec（必读） |

---

## 二、Task 0：数据库迁移（手动，阻塞后续所有任务）

**用户需在 Supabase 控制台 → SQL Editor 手动执行：**

```sql
ALTER TABLE threads ADD COLUMN trigger_source text;
```

执行后确认列存在再进行 Task 1。

---

## 三、涉及文件

| 文件 | 操作 |
|---|---|
| `src/lib/prompts.js` | **修改**：`getReviewLetterPrompt` 扩展 JSON schema |
| `src/lib/reviewLetterService.js` | **修改**：Step 7 改为串行，写 trigger_source / arc_summary / arc_updated_at / thread_entries |

**不需要改动：**
- `src/pages/CandidateDetailPage.jsx`：已有展示逻辑，字段补齐后自动生效
- `src/pages/ThreadsPage.jsx`：不涉及

---

## 四、Task 1：扩展 getReviewLetterPrompt（`prompts.js`）

找到函数末尾的 JSON schema 示例：

**改前：**
```json
{
  "suggested_threads": [
    { "action": "link", "thread_id": "已有脉络的uuid或null", "thread_name": "脉络名称" },
    { "action": "create", "thread_id": null, "thread_name": "建议新建的脉络名称" }
  ]
}
```

**改后：**
```json
{
  "suggested_threads": [
    {
      "action": "create",
      "thread_id": null,
      "thread_name": "建议新建的脉络名称",
      "discovery_reason": "2-3句话说明为什么注意到这条模式，引用用户原文中的词或场景，不泛泛而谈",
      "related_entry_indices": [0, 2]
    }
  ]
}
```

同时在 prompt 指令中：
- 删除 `link` action 的说明（本次不处理）
- 新增字段说明：
  - `discovery_reason`：2-3句，引用用户原文词汇，不泛泛而谈
  - `related_entry_indices`：上方日记摘要数组的序号（0-based，第0条 = 第1篇日记），可填多个

---

## 五、Task 2：改写 reviewLetterService.js Step 7

**改前（并行，无法取回 id）：**

```js
const toCreate = (insights.suggested_threads ?? [])
  .filter(t => t.action === 'create' && t.thread_name?.trim())
if (toCreate.length > 0) {
  await Promise.all(
    toCreate.map(t =>
      db.from('threads').insert({
        user_id: userId,
        name: t.thread_name.trim(),
        status: 'candidate',
      })
    )
  )
}
```

**改后（串行，取回 id，写 thread_entries）：**

```js
const toCreate = (insights.suggested_threads ?? [])
  .filter(t => t.action === 'create' && t.thread_name?.trim())

for (const t of toCreate) {
  // 1. 插入 thread，取回 id
  const { data: newThread, error: threadErr } = await db.from('threads')
    .insert({
      user_id: userId,
      name: t.thread_name.trim(),
      status: 'candidate',
      trigger_source: 'review',
      arc_summary: t.discovery_reason?.trim() || null,
      arc_updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (threadErr || !newThread) {
    console.error('[reviewLetter] 候选脉络创建失败:', threadErr?.message)
    continue  // 跳过这一条，不影响其他脉络
  }

  // 2. 计算关联 entry ids（过滤越界）
  const relatedEntryIds = (t.related_entry_indices ?? [])
    .filter(i => i >= 0 && i < entries.length)
    .map(i => entries[i].id)

  if (relatedEntryIds.length === 0) continue

  // 3. 批量写入 thread_entries
  const { error: teErr } = await db.from('thread_entries')
    .insert(
      relatedEntryIds.map(entryId => ({
        thread_id: newThread.id,
        entry_id: entryId,
        added_by: 'ai',
        removed_by_user: false,
      }))
    )

  if (teErr) {
    console.error('[reviewLetter] thread_entries 写入失败:', teErr.message)
    // 不抛出：thread 已创建，降级可接受
  }
}
```

⚠️ **注意**：`entries` 变量是 Step 3 构建 prompt 时使用的同一批 entry 对象（含 `.id` 字段），index 天然对齐，不需要二次查询。确认 `entries` 变量在 Step 7 的作用域内可访问。

---

## 六、成功验收清单

1. 生成回顾信后，进脉络页 → 候选脉络来源标签显示「回顾信触发 · [日期]」
2. 候选脉络详情页「AI 发现理由」区域显示 2-3 句非空文字，引用用户原文词汇
3. 候选脉络详情页关联记录 > 1，卡片显示对应日记摘要和日期
4. 接受/忽略候选脉络功能不受影响
5. `thread_entries` 写入失败时不影响脉络创建（console.error，静默降级）

---

## 七、注意事项

- `trigger_source` 列必须先迁移，否则 insert 整条失败（不是部分失败）
- `arc_summary` 字段在 threads 表已存在（第二批已建），不需要迁移
- `arc_updated_at` 字段需确认是否在 threads 表中存在；若不存在可省略，不影响核心功能
- 旧的候选脉络（已存在的）不回填，保持现状
- `link` action 本次不处理，filter 只保留 `action === 'create'`（现状不变）
