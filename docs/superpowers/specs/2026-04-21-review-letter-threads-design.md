# 回顾信详情页「相关脉络」设计文档

> 版本：2026-04-21

---

## §0 背景

回顾信生成时，AI 会在 `insights.suggested_threads` 里建议若干候选脉络，并自动写入 `threads` 表（`status='candidate'`）。但 `ReviewLetterDetail` 里这块区域目前是占位文字，用户无法看到 AI 发现了什么、也无法在信里直接处理这些脉络。

---

## §1 功能范围

- 替换占位文字，展示本封信关联的候选脉络卡片
- 每张卡片：脉络名称 + AI 发现理由 + 操作按钮（忽略 / 接受）
- 点击卡片跳转到对应详情页
- 操作后状态实时更新，全部处理完显示引导提示

**不做：**
- 在信里新建脉络（脉络由 AI 生成，不在此处手动创建）
- 脉络与日记条目的关联编辑（在 ThreadDetailPage 里做）

---

## §2 DB 变更

`threads` 表新增一列：

```sql
ALTER TABLE threads ADD COLUMN IF NOT EXISTS review_letter_id uuid REFERENCES review_letters(id) ON DELETE SET NULL;
```

- 生成回顾信时（`reviewLetterService.js` Step 7），创建 thread 时写入 `review_letter_id: letter.id`
- 已有的历史 candidate threads（无此字段）不受影响，`review_letter_id` 为 NULL 时不在信里展示

---

## §3 UI 设计

### 3.1 卡片区域位置

在 `ReviewLetterDetail` 信件正文下方，原占位符位置，分割线之后。

### 3.2 卡片结构

```
┌─────────────────────────────────────┐
│ 脉络名称              [待确认 badge] │
│ AI 发现理由（最多 3 行截断）          │
├──────────────────┬──────────────────┤
│      忽略        │    接受脉络       │
└──────────────────┴──────────────────┘
```

**已接受状态：**
- 卡片背景浅绿 `#f8fdf8`，边框 `#d4edda`
- 底部操作行替换为「✓ 已加入脉络追踪」（绿色文字）
- 点击卡片 → 跳转 `ThreadDetailPage`

**已忽略状态：**
- 卡片整体 opacity 0.7，灰色调
- 底部替换为「已忽略，不再追踪」（灰色文字）
- 不可点击

**待确认状态：**
- 白色卡片，金色「待确认」badge
- 点击卡片（非按钮区域）→ 跳转 `CandidateDetailPage`
- 底部「忽略」/ 「接受脉络」按钮直接操作

### 3.3 全部处理完

所有脉络均已接受或忽略后，卡片下方显示：

```
全部脉络已处理 · 可在「洞察」Tab 查看
```

### 3.4 无脉络时

`review_letter_id` 对应的 threads 为空（老信或 AI 未建议），不显示此区域（整个 section 隐藏）。

---

## §4 数据流

```
ReviewLetterDetail 挂载
  → fetchThreadsByLetterId(letter.id)
  → 返回 threads[]（status 可能是 candidate / confirmed / rejected）
  → 渲染卡片列表

用户点「接受脉络」
  → updateThreadStatus(threadId, 'confirmed')
  → 本地 state 更新，卡片变绿

用户点「忽略」
  → updateThreadStatus(threadId, 'rejected')
  → 本地 state 更新，卡片变灰

用户点卡片（待确认）→ onOpenCandidateDetail(thread)
用户点卡片（已接受）→ onOpenThreadDetail(thread)
```

---

## §5 新增 / 修改文件

| 文件 | 改动 |
|---|---|
| `src/lib/threadService.js` | 新增 `fetchThreadsByLetterId(letterId)` |
| `src/lib/reviewLetterService.js` | Step 7 创建 thread 时写入 `review_letter_id` |
| `src/components/ReviewLetterDetail.jsx` | 替换占位符，新增脉络卡片区域 |
| `src/pages/ReviewLetterListPage.jsx` 或 `MainLayout.jsx` | 确认 `onOpenCandidateDetail` / `onOpenThreadDetail` prop 已传入 ReviewLetterDetail |

---

## §6 成功验收标准

1. 生成新回顾信后，信详情页底部出现 AI 建议的脉络卡片
2. 点「接受脉络」→ 卡片变绿，状态持久化（刷新后仍是已接受）
3. 点「忽略」→ 卡片变灰，不可再操作
4. 点待确认卡片 → 跳转 CandidateDetailPage
5. 点已接受卡片 → 跳转 ThreadDetailPage
6. 无脉络的老信 → 不显示此区域
7. 全部处理完 → 显示引导提示文字
