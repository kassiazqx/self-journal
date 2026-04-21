# 回顾信生成时间过滤器修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉回顾信生成时对 `created_at` 的时间过滤，统一改为只看 `covered_by_letter_id IS NULL`，使补写的旧时间戳日记能被正确纳入自动和手动生成。

**Architecture:** 改动限于 `src/lib/reviewLetterService.js` 一个文件，涉及三处：`generateReviewLetter` 的查询条件、`checkAndGenerateLetter` 的计数查询和传参、`generateLetterNow` 的传参（后者已在上一次 session 改为传 `null`，需确认）。`periodStart` 参数保留，仅用于写入 `review_letters.period_start` 展示字段，不再影响 entry 查询范围。

**Tech Stack:** Supabase JS client，无新依赖

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/reviewLetterService.js` | 3 处改动（见下） |

---

## Task 1：`generateReviewLetter` 去掉 `.gt('created_at', periodStart)` 过滤

**Files:**
- Modify: `src/lib/reviewLetterService.js:52-61`

- [ ] **Step 1：替换 Step 1 的查询**

找到第 52-61 行：
```js
  const { data: entries } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, created_at')
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(8)
```

替换为：
```js
  const { data: entries } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, created_at')
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .order('created_at', { ascending: true })
    .limit(8)
```

删除 `.gt(...)` 和 `.lte(...)` 两行（`.lte('created_at', periodEnd)` 也一并去掉——查询当前快照就是"截止现在"，不需要显式上界）。

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

---

## Task 2：`checkAndGenerateLetter` 去掉计数查询的时间过滤 + 传 `null`

**Files:**
- Modify: `src/lib/reviewLetterService.js:208-220`

- [ ] **Step 1：替换计数查询**

找到第 208-213 行：
```js
  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')
```

替换为：
```js
  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
```

- [ ] **Step 2：替换 `generateReviewLetter` 的调用传参**

找到第 220 行：
```js
    await generateReviewLetter(userId, lastLetter?.period_end, prefs)
```

替换为：
```js
    await generateReviewLetter(userId, null, prefs)
```

（`periodStart` 传 `null`，`generateReviewLetter` 内部 `period_start: periodStart ?? entries[0]?.created_at` 会自动取最老条目的时间作为展示起点，更准确）

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

---

## Task 3：确认 `generateLetterNow` 已传 `null`（上一 session 已改，核对）

**Files:**
- Verify: `src/lib/reviewLetterService.js:224-237`

- [ ] **Step 1：核对现有代码**

读取第 224-237 行，确认 `generateLetterNow` 最后一行是：
```js
  await generateReviewLetter(userId, null, prefs)
```

如果已是 `null`，无需改动，直接进入下一步。  
如果仍是 `lastLetter?.period_end ?? null`，改为 `null`。

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

---

## Task 4：本地验收

```bash
npm run dev
```

**验收清单：**

1. 在设置页点「立即生成一封回顾信」→ 能正常生成（包括有旧时间戳未覆盖日记的情况）
2. 补写旧日期日记（`created_at` 早于上次信的 `period_end`）→ 累积到阈值后自动触发生成 → 这些条目被纳入信中
3. 生成后，上述日记的 `covered_by_letter_id` 被正确回写（不再出现在下次生成范围）
4. 没有 `covered_by_letter_id IS NULL` 的未覆盖条目时，手动触发仍提示"无新记录"（`NO_ENTRIES` 逻辑未变）

- [ ] **Step 1：完成上述手动验收后 commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "fix: 回顾信生成去掉 created_at 时间过滤，只看 covered_by_letter_id IS NULL"
```
