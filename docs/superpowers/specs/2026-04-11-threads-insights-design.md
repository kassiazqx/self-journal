# 第二阶段：脉络 / 洞察 / 回顾信增强 设计文档

> 本文档记录第二阶段新功能的设计决策。与旧 spec（2026-04-09-self-journal-redesign-design.md）平行存在，不覆盖旧文档。
>
> 视觉参考文件（可用 Read 工具读取）：
> - 笔记详情页 v4：`.superpowers/brainstorm/84652-1775889830/content/detail-v4.html`
> - 已确认决策总览：`.superpowers/brainstorm/84652-1775889830/content/confirmed-overview.html`

---

## §1 产品方向补充

第一阶段解决了"写"和"看单条记录"的问题。第二阶段解决：**时间积累后，内容如何产生跨条目的洞察？**

三个新对象，各司其职：

| 对象 | 职责 | 触发方式 |
|---|---|---|
| 回顾信（review_letter） | 叙事型阶段性回望，6~8 条 entry 一封 | 未覆盖 entry ≥ 6 条，或手动 |
| 脉络（thread） | 跨时间的主题型追踪，无时间上限 | 回顾信生成时 / 手动分析 / 手动创建 |
| 洞察页（InsightsPage） | 展示层，回顾信 + 脉络的统一入口 | 用户导航进入 |

三者关系：**平行，不从属**。回顾信不生成脉络，只提示关联；脉络有自己的独立生命周期。

---

## §2 数据库变更

### 2.1 journal_entries 新增字段

```sql
ALTER TABLE journal_entries
  ADD COLUMN entry_summary   text,           -- 一句话摘要，20~45字
  ADD COLUMN theme_hints     text[],         -- 主题标签，2~4项
  ADD COLUMN covered_by_letter_id uuid
    REFERENCES review_letters(id) ON DELETE SET NULL;
```

**为什么这三个字段：**
- `entry_summary` + `theme_hints`：轻量索引层，供脉络候选召回和回顾信生成使用，不用每次读全文
- `covered_by_letter_id`：标记哪些 entry 已被回顾信覆盖，用于触发下一封信的计数

### 2.2 threads 新表

```sql
CREATE TABLE threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  name          text NOT NULL,               -- 脉络名称，用户可编辑
  status        text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','confirmed','archived')),
  arc_summary   text,                        -- AI 生成的变化轨迹（一段叙事）
  arc_updated_at timestamptz,               -- arc_summary 最后更新时间
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
```

### 2.3 thread_entries 联结表

```sql
CREATE TABLE thread_entries (
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  added_at   timestamptz DEFAULT now(),
  added_by   text NOT NULL CHECK (added_by IN ('ai','user')),
  PRIMARY KEY (thread_id, entry_id)
);
```

`added_by` 区分是 AI 推荐加入还是用户手动加入，便于后续统计 AI 推荐准确率。

---

## §3 摘要索引提取（entry_summary + theme_hints）

### 3.1 何时提取

**懒触发**：不在用户保存 entry 时自动提取，而是在上层功能需要时批量补提取：

- 生成回顾信前：检查待覆盖的 6~8 条 entry，没有 entry_summary 的先提取
- 用户在洞察页触发「分析脉络」前：检查候选 entry，没有的先提取
- 批次大小：每次最多 10 条，超出则分批

### 3.2 AI Prompt 规范

**entry_summary 要求：**
- 一句完整的陈述句，20~45 字
- 记录"发生了什么 + 用户的核心反应"，不做评价
- 不写时间地点细节（"地铁上"可以，"4月10日早上9点10分在1号线"不行）
- 示例：`"地铁上被吵闹乘客影响，用慈悲心压下烦躁，但发现对'完全平静'的期待让自己更累"`

**theme_hints 要求：**
- 2~4 个短语，每个 4~10 字
- 写**可复用的心理主题**，不写一次性事件细节
- ✅ 正确：`["公共场所刺激敏感", "内心平静标准", "慈悲练习"]`
- ❌ 错误：`["地铁", "4月10日", "男生叫嚷"]`
- 判断标准：这个短语三个月后还能帮助识别"同类 entry"吗？能就留，不能就换

### 3.3 用户可手动编辑

entry_summary 和 theme_hints 在笔记详情页的「摘要索引」区展示，右侧有 ✎ 编辑入口（复用现有 EditableFieldRow 组件）。用户手动修改后，后续的脉络召回使用用户校正过的版本。

---

## §4 脉络系统（Threads）

### 4.1 触发时机

| 方式 | 描述 |
|---|---|
| A · 随回顾信生成 | 每次生成回顾信时，AI 顺带分析这批 entry 与已有脉络的关联，以及是否需要新建脉络候选 |
| B · 手动触发分析 | 用户在洞察页点「分析脉络」，可选时间跨度（近 90 天 / 近 1 年 / 全部） |
| C · 手动创建 | 用户直接命名，手动选 entry 加入，AI 可辅助整理（可选） |

方式 A 是主要的自动路径，B 和 C 是用户主动操作。

### 4.2 候选召回策略

触发分析时，本地代码先做粗召回，AI 只看精选后的轻量摘要：

```
本地粗召回（代码，零 token）：
  从 journal_entries 取候选，按以下权重评分：
    core_needs 有交集        → +3 分
    theme_hints 有交集       → +3 分
    emotions 有交集          → +1 分
    category_tags 有交集     → +1 分
    时间范围内               → +1 分（可选，用户设定）

  取评分 top-N（N ≤ 50）作为候选集

AI 分析（只看轻量数据）：
  每条候选只传：entry_summary + theme_hints + created_at
  不传原始 content（省 token，也保护隐私）
  AI 判断：哪些 entry 属于已有 thread / 应新建 thread
```

### 4.3 状态机

```
candidate  →  可以：确认(→ confirmed) / 忽略（留在 candidate）/ 删除
confirmed  →  可以：归档(→ archived) / 删除
archived   →  可以：恢复(→ confirmed) / 删除
```

AI 推荐产生的 thread 默认为 `candidate`，用户手动创建的默认为 `confirmed`。

### 4.4 变化轨迹（arc_summary）

每当 thread 有新 entry 加入时，触发一次 AI 生成，结果覆盖写入 `threads.arc_summary`。

**Prompt 约束（空性哲学）：**
- 使用试探性语言：「这段时间似乎…」「目前看可能…」「也许正在从…走向…」
- 不做永久性定性：禁止「你是一个…的人」「你总是…」
- 聚焦变化而非标签：描述轨迹，不描述固化特质

示例输出：
> "这条脉络从三月开始，最初你在公共场所感受到被外界噪音淹没的无力。四月初你尝试慈悲练习，但发现'完全不被影响'的期待反而让自己更累。目前这个主题似乎正在从'如何压制反应'慢慢走向'如何接纳有反应的自己'。"

### 4.5 页面结构

**脉络列表页（ThreadsPage）：**
```
┌─ 已确认脉络（confirmed）────────────────┐
│  按「最近有 entry 加入」时间倒序        │
│  每条显示：名称 + 最近更新时间 + entry数 │
│  点击 → 脉络详情页                      │
├─ 待确认（candidate）────────────────────┤
│  折叠，展开后可「接受」或「删除」        │
└──────────────────────────────────────────┘
右上角：「+ 新建脉络」
底部入口：「查看已归档」
```

**脉络详情页：**
```
脉络名称（可编辑）  [状态标签]  [归档/删除]

── 变化轨迹 ──────────────────────────────
[arc_summary 叙事段落]
最后更新：4月10日

── 关联记录 ──────────────────────────────
[entry 列表，按时间排，每条显示日期 + entry_summary]
[点击跳转 entry 详情]
```

---

## §5 回顾信增强

### 5.1 触发逻辑（与旧 spec §13 对接）

旧 spec 已定义触发条件（条数/天数/手动）。本阶段新增一个计数依据：

```
未被覆盖的 entry 数量 = journal_entries 中
  covered_by_letter_id IS NULL
  AND user_id = 当前用户
  AND template_type != 'freewrite'   ← 随手记不计入，内容太轻
```

达到设定阈值（默认 6 条）时提示用户生成，或手动触发。

### 5.2 生成流程

```
1. 取最近 6~8 条 covered_by_letter_id IS NULL 的 entry
2. 检查这批 entry 是否已有 entry_summary / theme_hints
   → 没有的先批量提取（§3 逻辑）
3. 把这批 entry 的 entry_summary + theme_hints + core_needs 传给 AI
4. AI 生成回顾信正文（叙事段落）
5. AI 在信末附上结构化 JSON（代码解析后用于展示关联标签）：
   ```json
   {
     "suggested_threads": [
       { "action": "link", "thread_id": "uuid-已有脉络id", "thread_name": "公共场所刺激" },
       { "action": "create", "thread_id": null, "thread_name": "慈悲练习探索" }
     ]
   }
   ```
   `action: "link"` = 与已有脉络关联；`action: "create"` = 建议新建脉络（状态默认 candidate）
6. 保存 review_letter 记录
7. 把这 6~8 条 entry 的 covered_by_letter_id 更新为新信的 id
```

### 5.3 回顾信中的脉络提示

AI 在生成信时，末尾自然语言提示脉络关联，不做硬编码卡片：

> "这几篇里有一个主题让我想到你之前也记录过类似的感受——在公共场所被外界刺激时的那种想平静又没法完全平静的张力。如果你感兴趣，可以把这些记录串在一起看看。"

代码层面：从 AI 返回的结构化 JSON 里提取 `suggested_threads`，在详情页展示为可点击的关联标签（见 detail-v4 里的 🧵 标签）。

### 5.4 回顾信卡片（在记录 tab 混合流中）

```
┌─────────────────────────────────────┐
│ 📬 回顾信              4月8日 · 4条  │
│ 这一周你在几个不同的场合，都试图在  │
│ 嘈杂中保持内心的平静……             │
│                          [阅读全文→] │
└─────────────────────────────────────┘
```

- 显示前两句正文（从 `review_letters.content` 截取）
- 与普通 entry 卡片的视觉区分：左侧加 3px 暖橙色竖线
- 点击跳转回顾信详情页（现有 ReviewLetterDetail.jsx）

### 5.5 首页新信气泡

有未读回顾信（`is_read = false`）时，写 Tab 顶部出现固定卡片：

```
┌─────────────────────────────────────┐
│ 📬 你有一封新的回顾信               │
│ 这一周你在几个不同的场合……         │
│                              [查看] │
└─────────────────────────────────────┘
```

- 无未读信时，卡片完全不渲染，写作区正常显示
- 用户点击进入 ReviewLetterDetail
- 停留超过 5 秒 → 自动调用 `markLetterRead(id)` → 卡片消失
- `markLetterRead`：`UPDATE review_letters SET is_read = true WHERE id = ?`

---

---

## §6 洞察页（InsightsPage）

### 6.1 页面结构

在现有心情曲线等图表上方，新增两个入口区块：

```
洞察

── 回顾信 ────────────────────────────────
[最新一封回顾信预览卡片]
[查看全部回顾信 →]（跳转至回顾信列表页）

── 脉络 ──────────────────────────────────
[已确认脉络列表，最多展示 3 条，按最近更新排]
[查看全部脉络 →]（跳转至 ThreadsPage）

── 近 30 天 ──────────────────────────────
心情曲线         ← 已有，保留不动
情绪频率         ← 已有，保留不动
核心需求分布     ← 已有，保留不动
```

**不改动已有图表的任何逻辑**，只在其上方插入新区块。

### 6.2 回顾信列表页（新建）

从洞察页点「查看全部回顾信」进入，独立页面（新建 `src/pages/ReviewLetterListPage.jsx`，不占 Tab 位置）：

```
回顾信

[4月8日 · 4条记录]     未读标记
 这一周你在几个不同的场合……
─────────────────────
[3月30日 · 6条记录]
 上周你在很多细小的事情里……
─────────────────────
...
```

- 按时间倒序，每封显示日期、覆盖条数、前两句摘要
- 未读的有视觉标记（橙点或加粗）
- 点击跳转 ReviewLetterDetail（已有组件）

---

## §7 笔记详情页变更

### 7.1 新增「摘要索引」区

位置：顶部信息卡（模板 badge + 情绪 chip）之后，核心字段之前。

视觉参考：detail-v4.html

```
摘要索引  · AI 提取，可手动调整
  一句话  [entry_summary，可编辑]        ✎
  主题标签 [theme_hints chip 列表，可编辑] ✎
```

实现：复用现有 `EditableFieldRow` 组件，`theme_hints` 编辑时用逗号或顿号分隔输入，保存时 split 成数组。

### 7.2 关联区新增脉络标签

现有关联区已有回顾信标签（✉），新增脉络标签（🧵）：

```
关联
  ✉ 这一周，你和外界的关系   ← 回顾信（已有）
  🧵 公共场所刺激             ← 脉络（新增）
```

数据来源：查 `thread_entries` 表，找出包含此 entry 的所有 thread，展示 thread.name。

---

---

## §8 本阶段不做的事

| 不做 | 原因 |
|---|---|
| 保存 entry 时自动提取 entry_summary | 每次保存触发 AI 成本高，懒触发够用 |
| 脉络之间的关联（thread 连 thread） | 复杂度高，需求不确定 |
| 洞察页 AI 生成阶段性总结段落 | 等数据积累到一定量再做 |
| 脉络的「泡泡」视觉风格 | 等整体 UI 重设计时一并做 |
| 定期后台自动触发脉络分析（cron） | 前期手动触发够用，免费版 Supabase 限制也不适合 |
| 从回顾信发起写作后关联到该信 | Phase 3，见旧 spec §5.3 预留字段说明 |

---

## §9 开发注意事项

### 9.1 必读旧 spec 的章节

代码 session 实现本阶段功能前，必须先读：

| 章节 | 原因 |
|---|---|
| 旧 spec §4（数据库） | 了解 journal_entries 和 review_letters 现有字段，避免重复定义 |
| 旧 spec §13（回顾信生成） | 了解 reviewLetterService.js 现有逻辑，在此基础上扩展 |
| 旧 spec §14（洞察页）| 了解现有图表组件，新区块插在图表上方不改现有逻辑 |
| arch-context.md §2.1 | 确认数据路径，不要混淆 conversations 表和 full_conversation 字段 |

### 9.2 AI 调用成本控制

```
entry_summary + theme_hints 提取：
  每批最多 10 条，每条约 200~400 token（含 prompt）
  批量一次调用，不要逐条调用

arc_summary 生成：
  每次 thread 更新触发一次，约 500~800 token
  结果缓存在 threads.arc_summary，浏览详情不重新调用

回顾信生成（含脉络分析）：
  每次约 1000~1500 token（6~8 条 entry 的摘要 + 生成信 + 脉络判断）
```

### 9.3 数据库操作顺序

必须先建表再写代码：

```
1. ALTER TABLE journal_entries（新增 3 个字段）
2. CREATE TABLE threads
3. CREATE TABLE thread_entries
4. 确认 RLS 策略（threads 和 thread_entries 都需要 user_id 过滤）
```

---

*文档完成。*
