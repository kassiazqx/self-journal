# 同步卡：全局搜索 + 筛选功能设计

> **架构 session 冷启动时读这一份即可。**
>
> - 完整 spec：`docs/superpowers/specs/2026-04-16-search-filter-design.md`
> - 上轮同步卡：`docs/sync-cards/2026-04-15-plan-deviations.md`

---

## 一、背景

RecordsPage 无搜索/筛选入口；ThreadDetailPage 编辑模式搜索只覆盖 2 个文字字段。本次设计新增全局搜索 + 多维筛选能力。

---

## 二、新增组件

**`src/components/FilterBar.jsx`**（新建）

- 封装搜索框 + 情绪浮层 + 类型浮层 + 日期月历
- 对外只暴露 `onFilter({ searchText, selectedEmotions, selectedCategories, selectedDate })` 回调
- 父页面（RecordsPage / ThreadDetailPage）负责执行 Supabase 查询，FilterBar 不直接访问数据库（除月历的 `datesWithRecords` 查询，见下）

---

## 三、关键技术决策

### 数组字段筛选用 `.overlaps()`，不用 `::text` cast

```js
query.overlaps('emotions', selectedEmotions)
query.overlaps('category_tags', selectedCategories)
```

Supabase JS 原生支持，绕开 §4.24（`::text` cast 触发 400）。

### 多条件 AND 逻辑

文字搜索 + 情绪 + 类型 + 日期四个维度同时激活时，全部 AND。

### 日期范围查询（UTC 偏差已知局限）

```js
.gte('created_at', new Date(y, m, d, 0, 0, 0).toISOString())
.lte('created_at', new Date(y, m, d, 23, 59, 59).toISOString())
```

`created_at` 存 UTC，用户选本地日期，存在 ±1 天偏差，当前阶段可接受。

### datesWithRecords 月历查询（FilterBar 内部）

月历展开或切换月份时，FilterBar 自己查当月所有 entry 的 `created_at`，计算哪些天有记录，用于日期字体颜色渲染（黑色 = 有记录，浅灰 = 无记录）。这是 FilterBar 唯一的数据库访问。需要 `userId` 通过 prop 或 `useAuth()` 传入。

---

## 四、页面集成差异

| | RecordsPage | ThreadDetailPage |
|---|---|---|
| 入口 | 右上角 🔍 图标，点击展开 | 编辑模式下直接可见 |
| 日期筛选 | ✅ 有 | ❌ 无（`showDate=false`） |
| 结果上限 | 50 条 | 30 条 |
| 额外排除逻辑 | 无 | 排除已关联 entry（含 `removed_by_user=true`） |
| 有筛选时回顾信 | 隐藏 | 不涉及 |

---

## 五、修改文件

| 文件 | 变更 |
|---|---|
| `src/components/FilterBar.jsx` | 新建 |
| `src/pages/RecordsPage.jsx` | 加 🔍 入口 + FilterBar + handleFilter 查询 |
| `src/pages/ThreadDetailPage.jsx` | 编辑模式下加 FilterBar（showDate=false） |

---

## 六、请架构检查的重点

1. **FilterBar 内部做 datesWithRecords 查询**是否违反 §2.2（db.js 分层）？FilterBar 是 components/ 层，直接用 `db.from()` 查数据是否合规？
2. **`.overlaps()` 的 RLS 安全性**：`.overlaps('emotions', [...])` 是否受 RLS 保护（即只查当前用户数据）？还是需要显式加 `.eq('user_id', user.id)`？
3. **UTC 时区偏差**：±1天偏差是否在现有架构风险清单中需要新增条目？
4. 是否有其他 §2 架构约束被违反？
