# 搜索筛选增强 功能设计

> 版本：2026-04-18
> 前置 spec：`docs/superpowers/specs/2026-04-16-search-filter-design.md`（原始 FilterBar 设计）

---

## §0 背景

在原有筛选器（情绪 / 类型 / 日期）基础上，新增两个筛选维度：

- **人物**（people_involved array overlap）
- **内心需求**（core_needs array overlap）

同时扩展文字搜索覆盖字段，从 `content + entry_summary` 扩展到再加三个 AI 提炼文本字段：`cognitive_analysis`、`body_sensations`、`reflection_insight`。

**涉及页面：**
- `RecordsPage`（记录列表页）
- `ThreadDetailPage`（脉络编辑关联记录模式）

**不改数据库，不新增文件。**

---

## §1 FilterBar 组件变更

### 1.1 新增 Props

在原有 props 基础上追加：

```
peopleOptions,    // string[] — 联系人 canonical 名称列表，来自 loadContacts()
coreNeedOptions,  // string[] — 需求词条列表，来自 loadCoreNeeds()
```

完整 Props 接口：

```js
FilterBar({
  onFilter,         // ({ searchText, selectedEmotions, selectedCategories,
                    //    selectedPeople, selectedCoreNeeds, selectedDate }) => void
  categoryOptions,  // string[]
  peopleOptions,    // string[]  ← 新增
  coreNeedOptions,  // string[]  ← 新增
  placeholder,      // string
  showDate,         // boolean
})
```

### 1.2 新增内部 State

```js
const [selectedPeople, setSelectedPeople] = useState([])
const [selectedCoreNeeds, setSelectedCoreNeeds] = useState([])
const [showPeopleMenu, setShowPeopleMenu] = useState(false)
const [showCoreNeedsMenu, setShowCoreNeedsMenu] = useState(false)
```

### 1.3 chip 行布局

新增两个入口 chip，紧跟「类型 ▾」之后，日期之前：

```
[情绪 ▾] [焦虑 ✕] [类型 ▾] [工作 ✕] [人物 ▾] [妈妈 ✕] [需求 ▾] [被理解 ✕] [日期 ▾]
```

**隐藏规则：**
- `peopleOptions.length === 0` 时，「人物 ▾」入口不渲染
- `coreNeedOptions.length === 0` 时，「需求 ▾」入口不渲染

### 1.4 浮层行为

与现有「情绪」「类型」浮层完全一致：

- 点 ▾ 展开，点浮层外或点 ✅ 关闭
- 多选，选中状态：金色填充（`background: #c9a96e, color: white`），未选中：边框灰色
- 浮层内容可滚动（词条多时）
- 同一时刻只有一个浮层展开（展开新浮层时自动关闭其他浮层）

### 1.5 onFilter 回调变更

原来：
```js
onFilter({ searchText, selectedEmotions, selectedCategories, selectedDate })
```

新增两个字段：
```js
onFilter({ searchText, selectedEmotions, selectedCategories,
           selectedPeople, selectedCoreNeeds, selectedDate })
```

### 1.6 重置逻辑

FilterBar 已有的 reset 函数（父页面关闭筛选面板时调用），需追加：
```js
setSelectedPeople([])
setSelectedCoreNeeds([])
```

---

## §2 文字搜索字段扩展

原来的 `.or()` 只覆盖 `content` + `entry_summary`，扩展为五个字段：

```js
const escaped = searchText.replace(/%/g, '\\%').replace(/_/g, '\\_')
query = query.or(
  `content.ilike.%${escaped}%,` +
  `entry_summary.ilike.%${escaped}%,` +
  `cognitive_analysis.ilike.%${escaped}%,` +
  `body_sensations.ilike.%${escaped}%,` +
  `reflection_insight.ilike.%${escaped}%`
)
```

**RecordsPage 和 ThreadDetailPage 的 handleFilter 均同步更新。**

---

## §3 查询逻辑新增

在现有 handleFilter 的条件构建中追加：

```js
// 人物筛选（数组任意匹配）
if (selectedPeople.length) {
  query = query.overlaps('people_involved', selectedPeople)
}

// 需求筛选（数组任意匹配）
if (selectedCoreNeeds.length) {
  query = query.overlaps('core_needs', selectedCoreNeeds)
}
```

**hasFilter 判断同步更新：**

```js
const hasFilter = searchText.trim() || selectedEmotions.length ||
                  selectedCategories.length || selectedPeople.length ||
                  selectedCoreNeeds.length || selectedDate
```

**select 字段补充**（原查询未选这两个字段）：

```js
.select('id, content, entry_summary, created_at, emotions, category_tags,
         people_involved, core_needs, template_type')
```

---

## §4 父页面变更

### 4.1 RecordsPage

mount 时并行加载联系人 + 需求词库（在现有 categoryOptions 加载旁边追加）：

```js
const [peopleOptions, setPeopleOptions] = useState([])
const [coreNeedOptions, setCoreNeedOptions] = useState([])

useEffect(() => {
  if (!user) return
  // 现有 categoryOptions 加载...
  loadContacts().then(list => setPeopleOptions(list.map(c => c.canonical)))
  loadCoreNeeds().then(list => setCoreNeedOptions(list.map(n => n.option_value)))
}, [user.id])
```

FilterBar 调用处追加两个 props：

```jsx
<FilterBar
  onFilter={handleFilter}
  categoryOptions={categoryOptions}
  peopleOptions={peopleOptions}      // ← 新增
  coreNeedOptions={coreNeedOptions}  // ← 新增
  placeholder="搜索记录内容、认知、洞见..."
  showDate={true}
/>
```

### 4.2 ThreadDetailPage

同样 mount 时加载（ThreadDetailPage 已有 loadContacts 调用，复用即可）：

```js
const [peopleOptions, setPeopleOptions] = useState([])
const [coreNeedOptions, setCoreNeedOptions] = useState([])

// 在现有 mount effect 中追加
loadContacts().then(list => setPeopleOptions(list.map(c => c.canonical)))
loadCoreNeeds().then(list => setCoreNeedOptions(list.map(n => n.option_value)))
```

FilterBar 调用处同样追加两个 props，`showDate={false}`。

---

## §5 成功标准

1. FilterBar chip 行出现「人物 ▾」「需求 ▾」两个新入口
2. 联系人库为空时，「人物 ▾」不显示；需求词库为空时，「需求 ▾」不显示
3. 点「人物 ▾」展开联系人浮层，选「妈妈」→ 列表只显示 people_involved 含「妈妈」的记录
4. 点「需求 ▾」选「被理解」→ 与人物筛选叠加（AND），列表进一步缩小
5. 点「妈妈 ✕」→ 只保留需求筛选，列表更新
6. 文字搜索「胸口」→ 命中 body_sensations 含该词的记录
7. 文字搜索「灾难化」→ 命中 cognitive_analysis 含该词的记录
8. 文字搜索「接纳」→ 命中 reflection_insight 含该词的记录
9. ThreadDetailPage 编辑模式：人物/需求筛选正常，结果仍排除已关联该脉络的 entry
10. 所有筛选条件（含人物/需求）在关闭筛选面板时完整清空
