# 同步卡：觉察卡片扩展（6 组 → 9 组）

**日期：** 2026-04-22
**Commits：** 0b13d45 / 0da9a36
**分支：** dev

---

## 变更摘要

将觉察流卡片从 6 组扩展为 9 组，每组问题数从 3 个增至 4-7 个，新增 acceptance/behavior/cognitive 三组，并将首组 `context` 重命名为 `focus`。

运行时逻辑（`getFilteredLocalNodes`、tier 过滤、`showWhen` 守门）**无需修改**，已兼容新结构。

---

## 修改文件

### `src/lib/awarenessFlowState.js`（Task 1）

| 变更 | 旧 | 新 |
|------|----|----|
| 组数 | 6 | 9 |
| 首组 id | `context` | `focus` |
| 新增组 | — | `acceptance`（tier 3）/ `behavior`（tier 4）/ `cognitive`（tier 5）|
| `context` 问题数 | 3 | 6（重写为更聚焦的切入角度）|
| `emotion` 问题数 | 3 | 5 |
| `body` 问题数 | 3 | 5 |
| `thought` 问题数 | 3 | 5 |
| `need` 问题数 | 3 | 6 |
| `insight` 问题数 | 3 | 7 |

**新组说明：**
- `acceptance`（tier 3, showWhen: 'negative'）：接纳练习，引导用户允许负面情绪存在，不强迫自己消除它
- `behavior`（tier 4, showWhen: 'always'）：行为反思，探索用户的第一反应和行动模式
- `cognitive`（tier 5, showWhen: 'always'）：认知重构，引导区分事实与解读，自我慈悲视角

**tier 顺序：**
```
focus(1) → emotion(2) → body(3) → acceptance(3) → thought(3) → behavior(4) → need(4) → cognitive(5) → insight(5)
```

### `src/lib/awarenessFlowState.test.js`（Task 2）

- L99：`assert.notEqual(paused.currentNode.promptId, 'context')` → `'focus'`
- L128：`assert.equal(paused.currentNode.promptId, 'context')` → `'focus'`
- 测试结果：8/8 全部 pass

---

## 架构约束确认

- `showWhen: 'negative'` 过滤逻辑不变（`body` / `acceptance` 仍仅在负面情绪时显示）
- `tier` 数值与 `question.tier < startTier` 过滤逻辑完全兼容
- `templates.js` 中 `awarenessStart: 'emotion'` 引用的是 tier 名，非 question id，不受影响
- `getAwarenessStartTier()` 逻辑不变
