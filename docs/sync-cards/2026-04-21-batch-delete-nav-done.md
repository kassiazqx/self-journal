# 同步卡：批量多选删除 + 返回按钮统一
**日期：** 2026-04-21
**状态：** ✅ 已上线（main 分支，Vercel 自动部署）

---

## 一、做了什么

### 功能 1：批量多选删除

| 交互 | 行为 |
|---|---|
| 长按任意日记条目 0.6s | 进入多选模式，该条目自动选中 |
| 点击条目 | 切换 checkbox，不触发详情跳转 |
| 日期组右侧圆圈 | 全选 / 取消全选当天所有可见条目 |
| 顶栏「删除」（金色） | selectedIds.size > 0 时可点，弹出确认 sheet |
| 确认 sheet「确认删除」 | 先清理 Storage 图片，再批量 DB 删除，退出多选 |
| 确认 sheet「取消」 | 关闭 sheet，保留多选状态 |
| 顶栏「取消」 | 退出多选，清空选中 |
| 多选模式下 | 回顾信卡片自动隐藏 |

**删除失败处理：** DB 删除返回错误时，确认 sheet 保持打开，用户知道操作失败，不会误以为已删除。

### 功能 2：返回按钮统一为 `‹`

以下 6 个页面返回按钮从「← 返回」/「← 脉络」文字统一为 `‹`（U+2039，fontSize 20，fontWeight 300）：

- RecordDetail（详情页）
- CandidateDetailPage（候选脉络）
- ThreadDetailPage（脉络详情）
- ReviewLetterDetail（回顾信详情）
- ReviewLetterListPage（回顾信列表）
- ThreadsPage（脉络列表）

**EditEntryPage 的「取消」文字保留不变**（语义不同，是操作取消而非页面返回）。

---

## 二、改动文件

| 文件 | 改动内容 |
|---|---|
| `src/lib/journalService.js` | 新增 `deleteEntries({ ids, userId })` 批量删除函数 |
| `src/pages/RecordsPage.jsx` | 多选全套实现（state + EntryCard + header + 日期组 + sheet + 函数） |
| `src/components/RecordDetail.jsx` | 返回按钮 → ‹ |
| `src/pages/CandidateDetailPage.jsx` | 返回按钮 → ‹ |
| `src/pages/ThreadDetailPage.jsx` | 返回按钮 → ‹ |
| `src/components/ReviewLetterDetail.jsx` | 返回按钮 → ‹ |
| `src/pages/ReviewLetterListPage.jsx` | 返回按钮 → ‹ |
| `src/pages/ThreadsPage.jsx` | 返回按钮 → ‹ |

---

## 三、架构说明

- **分层正确**：`deleteEntries` 在 `journalService.js`，UI state 全在 `RecordsPage`，没有跨层直调
- **Set 不可变性**：所有 `setSelectedIds` 调用均使用函数式更新 + `new Set(prev)`，无闭包 bug
- **两阶段删除顺序**：Storage 图片先删，DB 后删。Storage 失败不阻塞 DB（catch 只 log）；DB 失败不重置 UI
- **已知限制**：搜索过滤模式下，若选中条目不在当前 `allEntries` 分页窗口内（极少数情况），Storage 图片清理可能漏掉，但 DB 行会正确删除

---

## 四、长按行为变化说明

**之前**：长按单条 → 弹出「编辑 / 删除 / 取消」菜单
**现在**：长按单条 → 进入多选模式（首条自动选中），批量删除

单条编辑入口：进入详情页后点右侧 ✎ 图标。
单条删除入口：进入多选模式选一条 → 删除。
