# P1 Interaction Reliability Rebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改 P0 数据层架构前提下，修复 Lexical 写作/编辑场景的选区与标注交互不稳定问题。

**Architecture:** `journal_entries` 单一真源继续走 RTK `entrySlice` + `entryRepository` + `useEntry`。本轮只收口交互链：`RichTextEditor` / `AnnotationInteractionPlugin` / `useAnnotationInteraction` / `HomePage` / `EditEntryPage`。不重开 cache，不改 `refreshKey` 职责，不碰派生聚合刷新。

**Tech Stack:** React, Lexical, RTK, existing annotation hooks/components

---

## Scope

- 做：
  - HomePage / EditEntryPage 的 Lexical 选区稳定性
  - 首次选字/首次高亮失败修复
  - 桌面 mouse、移动端 touch、已标注文字点击 三条交互路径回归
- 不做：
  - P0 数据层返工
  - `refreshKey` / 感恩计数 / 未读回顾信刷新
  - AI 提取失败提示
  - ReviewLetter / ThreadDetail 标注交互改造

## Hard Rules

- `journal_entries` 状态管理继续默认 RTK；不回退旧 cache 思路
- Lexical 页面默认保持 `disableSelectionChange: true`；未完成根因验证前，不得把全局 `document.selectionchange` 重新开回去当 quick fix
- 上条只针对 DOM 文档事件；**不包括** Lexical 内部 `SELECTION_CHANGE_COMMAND`。移动端选区仍依赖 `AnnotationInteractionPlugin` 里的这条 editor 内部链路，不能误删
- 页面层只消费 `SelectionSnapshot` / `AnnotationSnapshot`
- 不在页面层重新从 DOM Range 计算 offsets
- 本轮主目标是编辑态交互；若改共享 hook，必须回归 `RecordDetail` / `ReviewLetterDetail` / `ThreadDetailPage`

## Files

- Modify: `src/components/RichTextEditor.jsx`
- Modify: `src/components/RichTextEditor/AnnotationInteractionPlugin.js`
- Modify: `src/hooks/useAnnotationInteraction.js`
- Modify: `src/pages/HomePage.jsx`
- Modify: `src/pages/EditEntryPage.jsx`
- Test/Verify: 手工交互矩阵
- Docs: `docs/arch-context.md`
- Docs: `docs/sync-cards/2026-04-27-p1-interaction-reliability-rebase.md`

### Task 1: 确认交互入口已收口（审计，不是重写）

> **当前代码状态（2026-04-27）**：HomePage / EditEntryPage 已经不在页面层做选区推导。
> 两个页面都通过 `handleSelectionSnapshot` / `handleAnnotationSnapshot` 回调消费 snapshot，
> 旧的 `handleMouseUp / handleTouchEnd / DOM Range offsets` 路径已收在 `useAnnotationInteraction`
> 和 `RichTextEditor` 内部，页面层没有暴露。

- [ ] 读 `HomePage.jsx` / `EditEntryPage.jsx` 确认两页面**只调用**：
  - `openMenuFromSelectionSnapshot(snapshot)`
  - `openMenuFromAnnotationSnapshot(snapshot)`
- [ ] 确认三条正式入口链路完整（trace 一遍，不要靠记忆）：
    - desktop: `MouseUpPlugin(mouseup) -> readSelection -> onRangeSelect -> handleDesktopRangeSelect -> handleSelectionSnapshot`
    - touch: `AnnotationInteractionPlugin(SELECTION_CHANGE_COMMAND, 300ms 防抖基线) -> createSelectionSnapshot -> onSelectionSnapshot`
    - annotated click: `AnnotationInteractionPlugin(CLICK_COMMAND) -> createAnnotatedNodeSnapshot -> onAnnotationSnapshot`
- [ ] 不删除 `useAnnotationInteraction` 仍暴露的 `handleMouseUp / handleTouchEnd / openMenuForRange`（只读页还在用）

**验收：**
- 三条链路能从代码 trace 完整，中途无断点
- 两个编辑页面层不含任何 `getSelection()` / `getBoundingClientRect()` / offset 推导

### Task 2: 修首次选字 / 首次高亮失败

> **当前已知嫌疑点（2026-04-27）**：`RichTextEditor.jsx:60-61` 已有一个
> `setTimeout(() => readSelection(rect), 0)` 兜底，注释说"首次 drag 选区偶发 Lexical
> selection 还没就绪"。这是当前已知的首次选字失败点，但这个 setTimeout 是否已经足够稳定，
> 或者还有其他遗漏点（如 snapshot text 为空、菜单被 clip/dedupe 吃掉），需要实测确认。

- [ ] 从 `RichTextEditor.jsx:52-65`（`MouseUpPlugin` 的 `handleMouseUp`）开始，先验证：
  - 首次拖选后，`readSelection` 同步路径是否返回 false（即 Lexical selection 还未就绪）
  - `setTimeout` 兜底是否稳定触发，或者有时也失败
- [ ] 首轮诊断先只加最小日志，不先改逻辑：
  - `readSelection` 内记录：`$getSelection()` 是否为空、`selectionToOffsets()` 是否返回 null
  - `createSelectionSnapshot` 内记录：offsets 是否存在、`text` 是否为空、snapshot 是否被直接丢弃
- [ ] 如果还有失败，补最小 console.log 定位是哪一步丢失：
  - offsets 拿不到（Lexical selection 问题）
  - offsets 有但 rect 空（DOM Range 问题）
  - snapshot 发出了但菜单没开（clip/dedupe 问题）
- [ ] 最终修复落在 `MouseUpPlugin` / `AnnotationInteractionPlugin` / `selectionSnapshot.js` 层，不在页面层打补丁
- [ ] 如果 `setTimeout(0)` 已经足够稳定，确认并在注释里写明"这不是随机补丁，是 Lexical 的已知时序"，保留即可；不稳定则换更可靠机制

**验收：**
- HomePage 桌面首次选字稳定弹菜单（连续测试 5 次无失败）
- HomePage 桌面第一次点高亮/下划线/加粗即可生效
- EditEntryPage 不回归

### Task 3: 保持只读页与编辑页边界清晰

- [ ] `useAnnotationInteraction` 继续同时支持：
  - 只读页 DOM selection 路径
  - 编辑页 snapshot 路径
- [ ] 但 Lexical 页面配置必须明确走 snapshot 路径
- [ ] 不为修编辑器 bug 改坏 `RecordDetail` / `ReviewLetterDetail` / `ThreadDetailPage`
- [ ] 若共享 hook 改动过大，优先在 editor/plugin 层加接缝，不把只读页拖进同一时序问题

**验收：**
- 编辑态修复后，只读页现有标注菜单、已标注点击、颜色替换不回归

### Task 4: 手工验证矩阵

- [ ] 桌面 Chrome:
  - HomePage 首次拖选文字 -> 菜单弹出
  - HomePage 首次点高亮 -> 立刻生效
  - HomePage 再次选同段 -> 菜单稳定，不跳位
  - EditEntryPage 首次拖选 -> 正常
  - 点击已标注文字 -> 菜单重开
- [ ] 移动端:
  - 长按拖拽选字 -> 走 `selectionchange + 300ms 防抖基线` 路径
  - 拖动 handle 过程中不提前弹
  - 停手后第一次操作即生效
- [ ] 保存相关:
  - 写作保存不丢最新文本
  - 编辑保存不丢标注
  - P0 的 `useEntry` / RTK 同步链不回归
- [ ] 只读页回归:
  - `RecordDetail` 选字弹菜单正常
  - `ReviewLetterDetail` 选字弹菜单正常
  - `ThreadDetailPage` 选字弹菜单正常

### Task 5: 文档收口

- [ ] 更新 `docs/arch-context.md`
  - §3 真实结构
  - §4 新规律/残余风险
  - §6 同步日志
- [ ] 新建同步卡：
  - `docs/sync-cards/2026-04-27-p1-interaction-reliability-rebase.md`
- [ ] 若还有未解点，明确写成“剩余单点风险”，不要混进 P2

## Done Definition

- Lexical 编辑态交互稳定
- 不新增第二套状态/刷新系统
- 不破坏 P0 RTK 数据层
- 文档与代码一致
