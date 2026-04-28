# 架构收口总方案（方案 A：分层渐进式收口）

> 目的：从产品架构根本出发，找到全局最优解，一次性理顺所有已知问题。
> 状态：P0 已落地，P1 主收口已完成，P3 代码与数据收口已完成；`legacy_only_count` 审计、历史回填、`full_conversation` 删列均已完成，当前剩余是手工质量验证与后续 AI 质量评估。

---

## 0. 决策前提

用户明确要求：
1. **全局一致优先**——不是哪个急就修哪个，而是从产品本身出发
2. **不要 A 逻辑 B 逻辑混用**——框架流程清晰统一，没有层层叠加保护和例外
3. **所有已知问题都要解决**——不只解决最痛的，找到总工作量最少、成功率最高的调整顺序
4. 大功能已全部完成，只剩细调和小改动
5. 目标：日活过百过千，小团队协作维护，最终打包 APK

---

## 1. P0 数据层架构：EntryRepository + EntityStore ✅ 已确认

> 本节是经过多轮 codex 审查后的最终确认版本，不再是讨论稿。

### 1.1 根因诊断

当前系统的核心问题不是"cache 有盲区"，而是：

1. **无单一真源**：`allEntries`、`entryCache`、`screen.entry`、`RecordDetail.entry`、`refreshKey` 五路并存，天然产生 A 逻辑 B 逻辑
2. **无唯一写入口**：UI 页面、conversationService、extractSummaryService、reviewLetterService 各写各，不经过共享层
3. **`updateEntry()` 不返回权威行**：前端只能靠猜或重新拉取，导致 4 秒保护窗、detailRefreshToken 等补丁规则
4. **导航传 entry 快照**：MainLayout 把 entry 对象推进 screens 栈，快照一旧就错

### 1.2 最终架构方案

```
┌─────────────────────────────────────────────────────┐
│                    UI 层（pages / components）        │
│  useEntry(id, { suspendRefetch })                    │
│  useEntryList(filters)                               │
│  导航只传 entryId，不传 entry 对象                    │
└─────────────┬───────────────────────────────────────┘
              │ 只通过 hook/repository 读写
┌─────────────▼───────────────────────────────────────┐
│               EntryRepository（交互实体读写）          │
│  getById / list / create / update / delete           │
│  invalidate(id)                                      │
│  所有读写统一用 JOURNAL_ENTRY_FULL_SELECT             │
│  所有写入返回完整权威行，立即 upsertIfNewer 进 store   │
└─────────────┬───────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────┐
│               EntityStore（RTK EntityAdapter）        │
│  按 id 归一化，存 session 内所有已获取 entries         │
│  upsertIfNewer：只接受 updated_at 更新的行            │
│  markStale(id)：标记需要重新拉取                      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│               EntryReadQueries（只读查询）             │
│  统计/导出/AI 上下文/脉络分析用                       │
│  直接查 DB，不连 store                               │
│  包住所有 DB 访问，不让 service 层散落碰 supabase      │
└─────────────────────────────────────────────────────┘
```

**接缝约束（本轮明确）：**
- `EntryRepository` 和 `EntryReadQueries` 都必须继续通过 `src/lib/db.js` 访问数据层，不直接 `import { supabase }`
- `db.js` 仍是唯一存储适配接缝；本轮不废弃这条约束
- 原因：未来切 SQLite / 本地存储时，仍只改 `db.js`

### 1.3 数据写入 / AI 提取触发分类规则

| 写入来源 | 处理方式 | 原因 |
|---|---|---|
| RecordDetail 保存标注 | update → full row → upsertIfNewer | 用户交互写 |
| EditEntryPage 保存编辑 | update → full row → upsertIfNewer | 用户交互写 |
| HomePage 新建日记 | insert → full row → upsertIfNewer | 用户交互写 |
| AwarenessFlow 保存问答流 | upsert `conversations.messages` | 保存完整问答流，不触发提取 |
| RecordDetail 手动 AI 分析 | update → full row → upsertIfNewer | 单条显式提取，只有用户点了才调 AI |
| extractSummaryService（批量补历史） | update DB → invalidate(id) | 批量后台任务，不要求立即更新 UI |
| reviewLetterService（写 covered_by_letter_id） | update DB → invalidate(id) | 后台写，非用户直接交互 |

**补充：**
- 这里的 “update DB” 指通过 `db.js` 适配层写 `journal_entries`，不是 service 直接 import `supabase`
- 当前正式口径只保留两种提取触发：`RecordDetail.handleAIAnalyze()` 手动提取、`extractSummaryService` 回顾信前批量提取
- `AIConversation.saveConversation() -> _backgroundProcess` 仅视为旧链残留，不再作为现行架构口径
- 所有提取输入都应统一到同一份 `fullText`：日记原文 + 题目原文 + 用户回答 + AI 问答
- 记忆更新文本必须按 `nodeType` 精确映射，本地卡片问题不能被误当成 AI 回复
- 回顾信富内容不能只读共享 `fullText`，还要补上用户后续手动修订的结构化字段
- `full_conversation` 删列不是当前默认执行项，需先做历史数据审计/必要时回填，再单独确认

### 1.4 useEntry hook 行为规范

```javascript
// 签名
function useEntry(id, { suspendRefetch = false } = {})

// 行为
// - entry._stale === true && suspendRefetch === false → 自动 refetch
// - entry._stale === true && suspendRefetch === true → 不自动 refetch（保护编辑态）
// - store miss → 自动 fetch 并 upsert

// 调用方负责传 suspendRefetch
const isDirty = useLocalDirtyState(entryId)  // 页面本地管理
const entry = useEntry(entryId, { suspendRefetch: isDirty })
```

**重要约束**：useEntry 内部不得引用任何页面级 state（如 dirty/form state）。dirty 状态由调用方传入，hook 只根据参数决定行为。

### 1.5 upsertIfNewer 规则

```javascript
// EntityStore reducer
upsertIfNewer(state, action) {
  const incoming = action.payload
  const current = state.entities[incoming.id]
  if (!current) {
    adapter.upsertOne(state, incoming)
    return
  }
  const incomingTime = new Date(incoming.updated_at).getTime()
  const currentTime = new Date(current.updated_at).getTime()
  if (incomingTime >= currentTime) {
    adapter.upsertOne(state, incoming)
  }
  // 更旧的行静默丢弃，不覆盖
}
```

### 1.6 JOURNAL_ENTRY_FULL_SELECT 统一 shape

所有交互实体读写（create / update / getById / list）统一使用 `JOURNAL_ENTRY_FULL_SELECT`（已定义在 `src/lib/entrySnapshots.js`），确保 create/update/getById/list 返回同一 shape，消灭"list 一种 shape，detail 一种 shape"的问题。

### 1.7 要删除的东西

P0 完成后，以下可以逐步删除：

| 要删的 | 替代方案 |
|---|---|
| `EntryCacheContext.jsx` | EntityStore via EntryRepository |
| `LOCAL_WRITE_PROTECTION_MS = 4000` | upsertIfNewer 按 updated_at 判断 |
| `hasCompleteEntry()` 字段白名单猜测 | JOURNAL_ENTRY_FULL_SELECT 统一 shape |
| `detailRefreshToken` | useEntry stale → 自动 refetch |
| `refreshKey`（entry 相关部分） | upsert 后 store 自动通知订阅者 |
| 导航层传 entry 对象 | 导航只传 entryId |

**注意**：`refreshKey` 还挂着列表副作用、回顾信、pending count、gratitude count 等非 entry 逻辑，需分批摘，不能一刀全删。

---

## 2. 五阶段推进计划

### P0：数据层收口（最高优先级）

**目标：** journal_entries 在所有页面之间数据一致，不再闪旧、不再丢更新。

详细实施计划见：[`docs/superpowers/plans/2026-04-27-p0-data-layer.md`](./2026-04-27-p0-data-layer.md)

---

### P1：交互可靠性

**目标：** 选区、标注、编辑器交互在桌面和移动端都稳定可靠。

| 项 | 说明 | 状态 |
|---|---|---|
| HomePage 桌面选字不弹菜单 | 撤掉实验性桥接层，桌面恢复 mouseup 路径 | 待做 |
| 标注交互稳定性 | selectionchange + 自适应防抖（已有方案） | 待做 |
| 编辑页交互可靠性 | EditEntryPage 桌面已稳定，需验证移动端 | 待验证 |

---

### P2：流程完整度

**目标：** 各功能流程走完，不会中途断掉或出现意外行为。

| 项 | 说明 | 状态 |
|---|---|---|
| 搜索/筛选结果的数据一致性 | 筛选后打开详情只传 entryId，从 store 读 | P0 已解决 |
| 删除统一语义 | 文本 + 图片删除流后移到 APK / 本地存储阶段一起收口 | 后移 |
| 提取失败轻反馈 | 当前产品决策接受“失败后手动重提取”，不单开 | 不做 |

---

### P3：AI 质量

**目标：** AI 对话、提取、记忆的质量和稳定性达到产品级。

| 项 | 说明 | 状态 |
|---|---|---|
| 提取触发口径统一 | 只保留手动提取 + 回顾信前批量提取两种模式 | 代码已完成 |
| fullText 数据源统一 | 所有提取/回顾信/记忆相关读取统一走 `conversations` 主路径的完整 fullText | 代码已完成 |
| 记忆文本构建收口 | `Settings` 改用按 `nodeType` 精确映射的记忆文本 builder | 代码已完成 |
| 回顾信富内容收口 | `shared fullText + 结构化补充字段`，不丢用户后修订内容 | 代码已完成 |
| `AIConversation` / `full_conversation` 旧链清理 | 先移除运行时代码依赖；DB 列仅在 `legacy_only_count` 审计 + 回填/放弃确认后清理 | 已完成（审计 9 → 回填 → 0 → 删列） |
| AI 提取字段质量 | 在输入统一后，再评估情绪、摘要、需求等输出质量 | 待评估 |
| 跨对话记忆质量 | Settings 改读 `conversations` 后，再评估 `rolling_summary` 质量 | 待评估 |
| 提取 prompt 优化 | 以统一 fullText 为前提，再做提示词微调 | 待排 |

---

### P4：UI 重构 + APK

**目标：** 全盘 UI 统一设计，打包 APK。

| 项 | 说明 | 状态 |
|---|---|---|
| UI 设计规范 | 建立 UI_GUIDELINES.md | 待做 |
| 全盘 UI 重构 | 按新设计规范统一所有页面 | 待排 |
| 安卓语音输入 | 通过 `useSpeechRecognition.js` 接缝替换 Web Speech，接入安卓可用方案 | 待排 |
| Capacitor APK 打包 | 功能稳定后执行 | 待排 |
| Cloudflare Pages 部署 | 国内访问（已在待办清单） | 待排 |

---

## 3. 用户原始问题清单 → 阶段映射

| # | 问题描述 | 阶段 | 备注 |
|---|---|---|---|
| 1 | RecordDetail 保存后返回列表再进闪旧 | P0 | EntryRepository + store 彻底解决 |
| 2 | 标注保存后详情数据不同步 | P0 | 同上 |
| 3 | 情绪修改保存后不一致 | P0 | `useEntry` + RTK 单一真源已收口 |
| 4 | HomePage 桌面选字不弹菜单 | P1 | 撤实验桥接层 |
| 5 | 标注交互不稳定 | P1 | selectionchange 方案 |
| 6 | 提取逻辑口径混乱（手动 / 批量 / 旧自动链并存） | P3 | 收口成两种提取模式 |
| 7 | 批量提取只吃原文，没吃完整 fullText | P3 | 统一改读 `conversations` 主路径 |
| 8 | 记忆更新文本把本地问题误当 AI 回复的风险 | P3 | 单独记忆文本 builder |
| 9 | 回顾信富内容可能丢掉后修订结构化字段 | P3 | `fullText + 结构化补充` |
| 10 | 语音输入安卓 | P4 | 平台能力，不混进当前提取收口 |
| 11 | UI 不统一 | P4 | 全盘重构 |
| 12 | APK 打包 | P4 | Capacitor |

---

## 4. 阶段间依赖

```
P0（数据层）──→ P1（交互）──→ P2（流程）──→ P3（AI）──→ P4（UI + APK）
     │              │
     │              └── P1 的标注交互依赖 P0 的数据一致性
     │
     └── P0 必须先做，后续所有阶段的验证都依赖数据层正确
```

P3 和 P4 之间相对独立，可以并行或调换顺序。

---

## 5. 相关文档

| 文档 | 用途 |
|---|---|
| `docs/superpowers/plans/2026-04-27-p0-data-layer.md` | P0 详细实施 plan |
| `docs/superpowers/plans/2026-04-27-p3-extraction-context-unification.md` | 本轮提取触发口径 + fullText 统一 plan |
| `docs/superpowers/plans/2026-04-26-cache-vs-rtk-handoff.md` | 旧决策讨论，已被本文档 §1 取代 |
| `docs/superpowers/plans/2026-04-26-annotation-stability-repair.md` | P1 选区修复方案参考 |
| `src/lib/entrySnapshots.js` | JOURNAL_ENTRY_FULL_SELECT 定义 |
