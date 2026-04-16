# 全局搜索 + 筛选功能设计

> 版本：2026-04-16
> 涉及页面：RecordsPage、ThreadDetailPage（编辑关联记录模式）

---

## §1 背景与目标

当前 RecordsPage 无任何搜索/筛选入口，ThreadDetailPage 编辑模式仅有文字搜索且只覆盖 2 个字段（content + entry_summary）。

本次新增：
- RecordsPage：右上角搜索图标，点击展开搜索框 + 情绪/类型/日期三个筛选器
- ThreadDetailPage 编辑模式：在现有搜索框下方加入情绪/类型筛选器（无日期）

---

## §2 FilterBar 组件

新建 `src/components/FilterBar.jsx`，封装所有搜索 + 筛选 UI，通过 props 与父页面通信。

### 2.1 Props 接口

```
FilterBar({
  onFilter,         // ({ searchText, selectedEmotions, selectedCategories, selectedDate }) => void
                    // 任何筛选变化时触发，父组件负责执行 Supabase 查询
  categoryOptions,  // string[] — 来自 user_options，用户的内容大类标签列表
  placeholder,      // string — 搜索框提示文字
  showDate,         // boolean — 是否显示日期筛选（RecordsPage: true，ThreadDetailPage: false）
})
```

### 2.2 组件内部 State

| state | 类型 | 说明 |
|---|---|---|
| `searchText` | string | 文字搜索内容 |
| `selectedEmotions` | string[] | 已选情绪词 |
| `selectedCategories` | string[] | 已选内容类型标签 |
| `selectedDate` | Date \| null | 已选日期，null 表示未选 |
| `showEmotionMenu` | boolean | 情绪浮层是否展开 |
| `showCategoryMenu` | boolean | 类型浮层是否展开 |
| `showCalendar` | boolean | 月历是否内联展开 |
| `calendarYear` | number | 月历当前显示年份 |
| `calendarMonth` | number | 月历当前显示月份（0–11） |
| `datesWithRecords` | Set\<string\> | 当月有记录的日期集合（'YYYY-MM-DD' 格式） |

---

## §3 FilterBar UI 行为

### 3.1 搜索框

- 文字输入 300ms debounce 后触发 `onFilter`
- 右侧 ✕ 清除搜索框内容（不关闭整个搜索面板）

### 3.2 筛选 chip 行

```
[情绪 ▾]  [焦虑 ✕]  [委屈 ✕]  [类型 ▾]  [工作 ✕]  [日期 ▾]
```

- 「情绪」「类型」「日期」为固定入口 chip，始终显示
- 已选的值作为独立 chip 插入对应入口 chip 右侧，点 ✕ 单独删除
- 筛选 chip 行可横向滚动（内容超出屏幕宽度时）

### 3.3 情绪浮层

- 点击「情绪 ▾」展开，再次点击或点浮层外或点 ✅ 关闭
- 浮层宽度撑满内容区，位置在 chip 行下方
- 情绪词排列顺序：**正面（20词）→ 横线 → 混合/中性（14词）→ 横线 → 负面（27词）**
- 无分组标题文字，只有横线分隔
- 词以 chip 形式排列（多列 wrap），选中状态：深色填充
- 右上角或底部有 ✅ 按钮关闭浮层；同时支持点浮层外关闭
- 浮层内容可滚动

### 3.4 类型浮层

- 交互方式与情绪浮层相同
- 内容：来自 `categoryOptions` prop（用户的 user_options 标签）
- 直接平铺，无分组，无横线

### 3.5 日期月历（仅 showDate=true 时显示）

- 点击「日期 ▾」→ 月历在 chip 行下方**内联展开**（把列表往下推），再点收起
- 月历顶部：`‹ 2026年4月 ›`，左右箭头切换月份
- 切换月份时重新查询 `datesWithRecords`（见 §5.3）
- **日期字体颜色规则：**
  - 有记录的日期：黑色（深色）
  - 无记录的日期：浅灰色
  - 今天：主题金色（`#c9a96e`），未选中时细圆圈描边
  - 选中日期：金色填充圆背景 + 白色字体（覆盖字体颜色规则）
- 点击日期：选中，触发 `onFilter`，月历**不自动收起**（保持展开，方便查看筛选结果后换日期）
- 再次点击同一日期：取消日期筛选（`selectedDate = null`）

---

## §4 RecordsPage 集成

### 4.1 入口

- 顶部右侧新增 🔍 图标
- 点击 → FilterBar 从顶部滑入（`showDate=true`），图标变为 ✕
- 点击 ✕ → FilterBar 收起，所有筛选清空，回到完整列表

### 4.2 列表行为

| 状态 | 列表内容 |
|---|---|
| FilterBar 关闭 | 完整混合列表（日记 + 回顾信），无限滚动，现有逻辑不变 |
| FilterBar 打开，无任何条件 | 同上，完整列表 |
| 任意筛选条件激活 | 仅显示 journal_entries，最多 50 条，不分页；回顾信卡片不出现 |

### 4.3 categoryOptions 来源

RecordsPage 在挂载时从 `user_options` 读取用户标签，传给 FilterBar：

```js
const [categoryOptions, setCategoryOptions] = useState([])
useEffect(() => {
  db.from('user_options')
    .select('option_value')
    .eq('user_id', user.id)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })
    .then(({ data }) => setCategoryOptions((data ?? []).map(r => r.option_value)))
}, [user.id])
```

---

## §5 ThreadDetailPage 集成

### 5.1 入口

- FilterBar 放在编辑模式搜索框下方，`showDate=false`
- 进入编辑模式时 FilterBar 直接可见（无需额外点击展开）
- 点「完成」退出编辑模式时，FilterBar 状态随之清空

### 5.2 列表行为

| 状态 | 列表内容 |
|---|---|
| 搜索框空 + 无筛选 | 默认列表（时间倒序，30条 + 加载更多），现有逻辑 |
| 有文字搜索 或 有筛选条件 | 过滤结果替换默认列表，最多 30 条，不分页 |

**无论何种状态，始终排除已关联此脉络的 entry（含 removed_by_user=true）。**

### 5.3 datesWithRecords 查询（FilterBar 内部）

月历展开或切换月份时，FilterBar 内部查询：

```js
async function fetchDatesWithRecords(year, month) {
  const start = new Date(year, month, 1).toISOString()
  const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString()
  const { data } = await db.from('journal_entries')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', start)
    .lte('created_at', end)
  const dates = new Set(
    (data ?? []).map(r => {
      const d = new Date(r.created_at)  // 转为设备本地时间
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })
  )
  setDatesWithRecords(dates)
}
```

日期查询范围使用设备本地时间构造，自动处理时区：
```js
new Date(y, m, d, 0, 0, 0).toISOString()  // 本地午夜 → 转 UTC
```
两处均用设备本地时间，不存在时区偏差问题。

---

## §6 查询逻辑

父页面在 `onFilter` 回调里构建 Supabase 查询，条件之间为 **AND 关系**（必须同时满足）。

```js
async function handleFilter({ searchText, selectedEmotions, selectedCategories, selectedDate }) {
  // 无任何条件时直接恢复默认列表，不查询
  const hasFilter = searchText.trim() || selectedEmotions.length ||
                    selectedCategories.length || selectedDate
  if (!hasFilter) { restoreDefaultList(); return }

  let query = db.from('journal_entries')
    .select('id, content, entry_summary, created_at, emotions, category_tags, template_type')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)  // RecordsPage；ThreadDetailPage 用 .limit(30)

  // 文字搜索（content + entry_summary）
  if (searchText.trim()) {
    const escaped = searchText.replace(/%/g, '\\%').replace(/_/g, '\\_')
    query = query.or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%`)
  }

  // 情绪筛选（overlaps：数组中有任意一个匹配即可）
  if (selectedEmotions.length) {
    query = query.overlaps('emotions', selectedEmotions)
  }

  // 类型筛选
  if (selectedCategories.length) {
    query = query.overlaps('category_tags', selectedCategories)
  }

  // 日期筛选（当天 00:00–23:59 UTC）
  if (selectedDate) {
    const y = selectedDate.getFullYear()
    const m = selectedDate.getMonth()
    const d = selectedDate.getDate()
    query = query
      .gte('created_at', new Date(y, m, d, 0, 0, 0).toISOString())
      .lte('created_at', new Date(y, m, d, 23, 59, 59).toISOString())
  }

  const { data } = await query
  setFilteredEntries(data ?? [])
}
```

ThreadDetailPage 额外在查询结果上过滤已关联 entry：

```js
const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
setFilteredEntries((data ?? []).filter(e => !allExistingIds.has(e.id)))
```

---

## §7 成功标准

1. RecordsPage 点 🔍 → 搜索框 + 三个筛选器滑入
2. 选择情绪「焦虑」→ 列表只显示 emotions 含「焦虑」的记录
3. 再叠加类型「工作」→ 列表进一步缩小为同时满足两者的记录
4. 点「焦虑 ✕」→ 只保留类型筛选，列表更新
5. 点日期 4月12日 → 只显示当天的记录；再次点击取消日期筛选
6. 月历中有记录的日期字体黑色，无记录浅灰色
7. 点 ✕ 关闭搜索面板 → 所有筛选清空，回到完整混合列表（含回顾信）
8. ThreadDetailPage 编辑模式 → 情绪/类型筛选正常工作，过滤结果仍排除已关联 entry
9. 情绪浮层：正面→中性→负面顺序，横线分隔，✅ 按钮可关闭
