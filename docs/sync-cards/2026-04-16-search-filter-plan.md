# 同步卡：全局搜索 + 筛选 · 代码执行交接

> **代码 session 冷启动读这一份即可。**
>
> - 完整 plan：`docs/superpowers/plans/2026-04-16-search-filter.md`
> - 完整 spec：`docs/superpowers/specs/2026-04-16-search-filter-design.md`
> - 架构上下文：`docs/arch-context.md`（必读 §2、§4）

---

## 任务概述

新建 `FilterBar.jsx` 共享组件，并集成到 `RecordsPage` 和 `ThreadDetailPage`，实现全局搜索 + 情绪/类型/日期三维筛选。

**涉及文件（共 3 个）：**

| 文件 | 操作 |
|---|---|
| `src/components/FilterBar.jsx` | 新建 |
| `src/pages/RecordsPage.jsx` | 修改 |
| `src/pages/ThreadDetailPage.jsx` | 修改 |

---

## 执行顺序

按 Task 顺序执行，每个 Task 做完跑 `npm run build` 确认无报错再继续。

### Task 1：新建 FilterBar.jsx

Plan 里有完整组件代码，直接复制写入 `src/components/FilterBar.jsx`。

**关键注意点：**
- `useAuth()` 从 `'../contexts/AuthContext'` 导入（不接受 userId prop，§4.25）
- `db` 从 `'../lib/db'` 导入（不是 supabase.js）
- 情绪数组定义在文件顶部，顺序：POSITIVE → MIXED → NEGATIVE
- `datesWithRecords` 查询：用 `new Date(r.created_at)` 转本地时间取日期，**不要用** `slice(0,10)`（那是 UTC 日期，会有时区偏差）
- `onFilter` 触发时机：任何 state 变化均触发，搜索框 300ms debounce，其余立即触发

### Task 2：修改 RecordsPage.jsx

Plan 有分步说明（Step 1–10），核心改动：

1. import FilterBar
2. 新增 3 个 state：`showSearch`、`categoryOptions`、`filteredEntries`（null = 无筛选）
3. 新增 useEffect 加载 `user_options`（field_name = `'content_category'`）
4. 新增 `handleFilter()` 函数（overlaps + ilike + 日期范围，limit 50）
5. return 结构改为：外层 flex 容器 → sticky header（「记录」文字 + 🔍/✕ 按钮）→ FilterBar（showSearch 时显示）→ 内层滚动 div
6. `items` 变量：`filteredEntries !== null` 时只用筛选结果（无回顾信）；否则用原来的合并逻辑
7. 空状态文案：筛选模式显示「没有符合条件的记录」，默认模式显示「还没有记录，去写第一条吧」
8. 内层滚动 div 的 `onScroll`：有筛选时传 `undefined`（筛选结果不分页）

**层级结构（注意不要多一个或少一个 `</div>`）：**
```jsx
<div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
  <div style={{ flexShrink: 0 }}>   {/* sticky 区域 */}
    {/* Header */}
    {/* FilterBar（条件渲染） */}
  </div>
  <div style={{ flex:1, overflowY:'auto' }} onScroll={...}>  {/* 滚动区 */}
    {/* 回顾信横幅 */}
    {/* 列表 */}
  </div>
</div>
```

### Task 3：修改 ThreadDetailPage.jsx

Plan 有分步说明（Step 1–9），核心改动：

1. import FilterBar
2. 新增 state：`filterConditions`（null = 无筛选）、`categoryOptions`（[]）
3. 新增 useEffect 加载 user_options（同 Task 2）
4. 新增 `handleFilter()` 函数（overlaps + ilike，limit 30，始终排除 `allExistingIds`）
5. 「完成」按钮 onClick 追加 `setFilterConditions(null)` 清空
6. 修改 searchQuery 的 useEffect：加 `filterConditions` 依赖，有筛选条件时不触发 `loadDefaultEntries(0)`
7. 在搜索框 `<input>` 下方插入 `<FilterBar showDate={false} .../>`
8. 两段条件渲染（`searchQuery.trim() &&` 和 `!searchQuery.trim() &&`）改为：
   - `(searchQuery.trim() || filterConditions) &&` → 显示 searchResults
   - `!searchQuery.trim() && !filterConditions &&` → 显示 defaultEntries
9. `handleScroll` 加 `|| filterConditions` 判断，有筛选时不触发加载

### Task 4：验证 + 提交

`npm run dev` 后，**手动验证以下清单，所有条目通过后再 commit**：

**RecordsPage（12 项）：**
1. 「记录」页右上角有 🔍 图标
2. 点 🔍 → 搜索框 + chip 行出现
3. 输入文字 → 列表更新（只有日记，无回顾信卡片）
4. 点「情绪 ▾」→ 浮层展开，三组排列（正面/混合/负面），横线分隔，✅ 关闭
5. 选情绪词 → chip 行出现「词 ✕」，列表按情绪筛选
6. 再选类型 → AND 逻辑，列表进一步缩小
7. 点情绪 chip ✕ → 移除单个情绪，列表更新
8. 点「日期 ▾」→ 月历内联展开，黑色/浅灰字体颜色区分有无记录，今天金色圆圈
9. 点某天 → 日期 chip 出现，列表只显示当天；月历不自动收起
10. 再次点同一天 → 取消日期筛选
11. ‹ / › 切换月份 → 月历更新，重新查 datesWithRecords
12. 点右上角 ✕ → FilterBar 收起，筛选清空，列表恢复完整（含回顾信）

**ThreadDetailPage（7 项）：**
1. 进入脉络 → ··· → 编辑关联记录 → 进入编辑模式
2. 搜索框下方有 FilterBar（情绪/类型，无日期）
3. 选情绪 → 未关联记录按情绪筛选；已关联记录（上方）不受影响
4. 输入文字 + 有情绪筛选 → AND 逻辑
5. 已关联记录不出现在结果中
6. 清空所有筛选 → 恢复默认分页列表
7. 点「完成」→ FilterBar 状态清空

**验证通过后：**
```bash
git add src/components/FilterBar.jsx src/pages/RecordsPage.jsx src/pages/ThreadDetailPage.jsx
git commit -m "feat: add global search + filter bar (FilterBar, RecordsPage, ThreadDetailPage)"
```

---

## 架构约束（必须遵守）

- **§4.24**：不能对数组字段用 `::text` cast，必须用 `.overlaps('emotions', [...])` / `.overlaps('category_tags', [...])`
- **§4.25**：FilterBar 内部通过 `useAuth()` 获取 userId，不接受 userId prop
- **§4.26**：日期范围查询用 `new Date(y, m, d, 0/23, 0/59, 0/59).toISOString()`（本地时间转 UTC），datesWithRecords 用 `new Date(r.created_at)` 取本地日期
- **§2.2**：db 层调用从 `'../lib/db'` 导入，不从 supabase.js 直接导入

---

## 偏差处理规范

代码 session 执行过程中，如发现 plan 描述与实际代码有出入（行号偏差、原有代码结构不同等），**自行判断修正，不需要停下来请示**。

如发现架构层面的问题（如 Supabase API 行为异常、新的 §4.x 限制），**停下来报告，列明偏差内容，不自行修复，等用户确认**。
