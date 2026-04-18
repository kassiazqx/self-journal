# 同步卡：写作页 ↔ 觉察流导航修复

> - git commits：`f509503` → `33faee0`
> - 完成日期：2026-04-18
> - **状态：✅ 全部完成**

---

## 一、问题描述

### Bug 1：觉察流退回主写作页后内容消失
- **路径**：写内容 → 点 ✓ → 进觉察卡片 → 点「← 上一张」退回写作页
- **现象**：写作页内容为空，无法继续编辑或重新进入觉察流
- **根本原因**：`handleDone` / `handleDeepAwareness` 在触发导航跳转后立即 `setContent('')`，由于 HomePage 是**常驻挂载**（display:none 切换），返回时内容已被清空

### Bug 2：退回后再次点 ✓ 重复创建 entry
- **路径**：退回写作页（内容还在）→ 再次点 ✓ → 进觉察流
- **现象**：记录列表出现两条相同内容的记录
- **根本原因**：`handleDone` 每次执行都生成新 `crypto.randomUUID()` + `insertEntry`，没有机制判断该内容已经提交过

### Bug 3：退回再进觉察流时卡片内容是空的
- **路径**：填完觉察卡1、2 → 退回写作页 → 再次点 ✓ → 进觉察流
- **现象**：之前填的卡片全部清空
- **根本原因**：Bug 2 产生了新 entry（新 id），AwarenessFlow 按 entry.id 查 conversations 恢复，新 id 查不到历史，卡片全空

---

## 二、修复方案

### 方案来源
还原 commit `718c1f7`（"统一觉察流导航"）的设计意图：退出觉察流时**以编辑模式**打开写作页，而非清空后重新建。

### 具体改动

**`src/pages/HomePage.jsx`（commit f509503）**
- 删除 `handleDone` 新建模式里的重置代码（`setContent('')` / `setTemplate(DEFAULT_TEMPLATE)` / `setSelectedPeople([])`）
- 删除 `handleDeepAwareness` 里同样的重置代码
- 内容清空改由 MainLayout 在觉察流**完成**时通过 `writeResetKey` 重挂 HomePage 完成

**`src/components/MainLayout.jsx`（commit f509503 + 33faee0）**
- 新增 `writeResetKey` state；`handleAwarenessComplete` 递增 → HomePage 重挂清空写作区
- `handleAwarenessExit`：不再 `pop()`，改为推 `{ type: 'editHome', entry, awarenessState }`
- 新增 `handleEditHomeDone`：从 `editHome` screen 读出 `awarenessState`，推 `{ type: 'awareness', entry, initialFlowState: awarenessState }` 回到觉察流中断位置
- `renderScreen` 新增 `editHome` 分支：以 `editEntry={screen.entry}` 渲染 `<HomePage>`

---

## 三、修复后的完整流程

```
写内容 → 点 ✓
  → HomePage.handleDone（新建）→ insertEntry → onDone(optimisticEntry, true)
  → MainLayout.handleHomeSaved → push({ type: 'awareness', entry })
  → AwarenessFlow 打开，填卡片1、卡片2
  ↓
  点「← 上一张」（在第一张再退）
  → AwarenessFlow.handleBack → onExit(awarenessState)
  → MainLayout.handleAwarenessExit
  → push({ type: 'editHome', entry, awarenessState })
  → renderScreen 渲染 <HomePage editEntry={entry} />（编辑模式）
  ↓
  用户看到原文，可修改
  点 ✓（编辑模式）
  → HomePage.handleDone（编辑模式）→ updateEntry（不重复创建）→ onDone(updatedEntry, false)
  → MainLayout.handleEditHomeDone
  → push({ type: 'awareness', entry: updatedEntry, initialFlowState: awarenessState })
  → AwarenessFlow 从中断位置恢复（从 DB conversations 读历史填答）
  ↓
  走完所有卡片 → 点「完成」
  → MainLayout.handleAwarenessComplete
  → writeResetKey++ → HomePage 重挂（写作区清空）
  → goTab('records')
```

---

## 四、关键设计决策

| 决策点 | 旧方案 | 新方案 | 原因 |
|---|---|---|---|
| 清空写作区时机 | `handleDone` 触发跳转后立即 `setContent('')` | 觉察流「完成」时通过 `writeResetKey` 重挂 | HomePage 常驻挂载，提前清空会导致退回时内容消失 |
| 退出觉察流后的写作页 | `pop()` 回写作页（新建模式，内容已空） | 推 `editHome` screen，以编辑模式打开写作页 | 编辑模式从 entry.content 读内容，点 ✓ 走 updateEntry 不重复建记录 |
| 再次进觉察流时恢复状态 | 新 entry → AwarenessFlow 查不到历史 | 同一 entry + awarenessState（退出时的 flowState 快照）→ 从中断位置恢复 | 保持用户填写进度 |

---

## 五、验收标准

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 写内容 → 进觉察流 → 退回 → 写作页内容还在 | ✅ |
| 2 | 退回后再次点 ✓ → 不重复创建记录 | ✅ |
| 3 | 退回后再次进觉察流 → 卡片历史填答已恢复 | ✅ |
| 4 | 完整走完觉察流 → 跳记录列表 → 切回「写」tab → 写作区清空 | ✅ |
| 5 | 从记录详情进觉察流（非写作页路径）不受影响 | ✅（未动该路径代码）|
