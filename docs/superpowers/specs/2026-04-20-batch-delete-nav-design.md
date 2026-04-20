# 批量多选删除 + 导航栏统一 设计文档

> 版本：2026-04-20

---

## §0 背景

两个独立改动，打包成一个 spec：

1. **批量多选删除**：记录列表页长按进入多选模式，支持单条/整天/跨天多选后批量删除
2. **顶栏返回按钮统一**：所有详情/覆盖页的「← 返回」「← 脉络」等文字按钮，统一改为极简 `<` 图标（EditEntryPage「取消」保留）

---

## §1 批量多选删除

### 1.1 交互流程

**正常模式（现状）：**
- 单击 EntryCard → 进入详情页
- 长按 600ms → 弹出单条操作菜单（编辑 / 删除 / 取消）

**改后：**
- 单击 EntryCard → 进入详情页（不变）
- 长按 600ms → **进入多选模式**（取消单条菜单）

> ⚠️ 「编辑」从长按菜单移除。单条编辑入口改为：进入详情页 → 点 ✎（见 UI小批次同步卡 Task 3）

### 1.2 多选模式 UI

**顶栏变化：**
```
[取消]       已选 N 条       [删除]
```
- 「取消」退出多选模式，清空已选
- 「删除」按钮灰色禁用（N=0），有选中时变金色可点

**每条 EntryCard 左侧出现圆形 checkbox：**
- 未选：空心圆圈（border: 1.5px solid #ddd）
- 已选：金色填充 + 白色对勾（background: #c9a96e）
- 点击 EntryCard 任意位置 = 切换选中状态

**日期组标题行右侧出现「全选当天」checkbox：**
- 未全选：空心圆圈
- 已全选：金色填充对勾
- 部分选中：金色半填充（中间横线）
- 点击 = 全选/取消全选 当天所有条目

**回顾信卡片**（顶部固定卡片）在多选模式下不参与选择，无 checkbox，不可选中。

### 1.3 删除确认

点「删除」后弹底部确认 sheet：
```
删除 N 条记录？
此操作不可恢复。
[取消]   [确认删除]
```

确认后：
1. 依次调 `deleteEntry` 删除所有选中条目
2. 退出多选模式
3. 刷新列表

> 📌 **未来兼容回收站**：届时改为软删除（设 `deleted_at`），确认文字改为「移入回收站」，本次不做，接口预留（统一走 `deleteEntry` 函数，届时只改该函数内部实现）

### 1.4 涉及改动（RecordsPage.jsx）

| 位置 | 改动 |
|---|---|
| 顶层 state | 新增 `isSelecting`（boolean）、`selectedIds`（Set） |
| `EntryCard` | 新增 `isSelecting`、`isSelected`、`onToggle` props；左侧加 checkbox；点击逻辑分支 |
| 日期组标题 | 新增「全选当天」checkbox；计算当天是否全选/部分选 |
| 顶部 header | 多选模式时替换为「取消 / 已选N条 / 删除」行 |
| 长按 handler | `onLongPress` 改为调 `setIsSelecting(true)` + 把当前条目加入 `selectedIds` |
| 删除确认 sheet | 新增，替换原来的单条确认弹窗（原弹窗逻辑可复用样式） |

**不改动：**
- `deleteEntry`（journalService.js）：逻辑不变
- 时间流渲染逻辑、筛选逻辑、无限滚动逻辑：均不改

---

## §2 顶栏返回按钮统一为 `<`

### 2.1 涉及页面

| 文件 | 当前文字 | 改后 |
|---|---|---|
| `src/components/RecordDetail.jsx` | `← 返回` | `<` |
| `src/pages/CandidateDetailPage.jsx` | `← 脉络` | `<` |
| `src/pages/ThreadDetailPage.jsx` | `← 返回` | `<` |
| `src/pages/ReviewLetterDetail.jsx` | `← 返回` | `<` |
| `src/pages/ReviewLetterListPage.jsx` | `← 返回` | `<` |
| `src/pages/ThreadsPage.jsx` | `← 返回` | `<` |
| `src/pages/EditEntryPage.jsx` | `取消` | **保留不变** |

### 2.2 样式规范

所有 `<` 按钮统一：
```jsx
<button onClick={onBack} style={{
  background: 'none', border: 'none',
  color: '#bbb', cursor: 'pointer',
  fontSize: 20, fontWeight: 300,
  padding: '6px 8px', margin: '-6px -8px',  // 扩大触摸区
  lineHeight: 1,
}}>
  ‹
</button>
```

使用 `‹`（单书名号，U+2039）而非 `<`，视觉更接近 iOS 风格，更圆润。

---

## §3 不涉及范围

- 回收站（7天时效）：本次不做，`deleteEntry` 接口预留，届时只改内部实现
- EditEntryPage「取消」按钮不变（有语义：提示用户操作可能被丢弃）
- 多选模式下不支持「编辑」（单条编辑通过详情页 ✎ 入口操作）

---

## §4 成功验收标准

**批量多选：**
1. 长按任意日记条目 600ms → 进入多选模式，顶栏变为「取消 / 已选0条 / 删除（灰）」
2. 点击条目 → checkbox 切换选中，顶栏计数更新
3. 点日期组「全选当天」→ 当天所有条目全选；再点 → 全取消
4. 选中 N 条后点「删除」→ 底部弹出确认 sheet → 确认后删除并刷新列表
5. 点「取消」或删除成功后退出多选模式
6. 回顾信固定卡片不出现 checkbox，不可选中

**返回按钮：**
1. 所有列出页面的返回按钮改为 `‹` 图标，样式统一
2. EditEntryPage「取消」文字保留
3. 点击 `‹` 功能与原返回逻辑一致
