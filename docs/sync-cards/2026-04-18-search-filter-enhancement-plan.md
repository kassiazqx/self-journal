# 同步卡：搜索筛选增强 · 代码 Session

> **代码 session 冷启动必读。按顺序读完再动手。**

---

## 一、必读文档

| 文档 | 说明 |
|---|---|
| `docs/arch-context.md` §2（特别是 §2.11） | 架构约束，含本次新增决策 |
| `docs/coding-lessons.md` | 8 条编码规则 |
| `docs/superpowers/specs/2026-04-16-search-filter-design.md` | 原始 FilterBar 完整设计（必读，理解现有结构） |
| `docs/superpowers/specs/2026-04-18-search-filter-enhancement-design.md` | 本次增量 spec |

---

## 二、任务概览

**不新增文件，不改数据库。仅修改三个文件：**

| 文件 | 改动 |
|---|---|
| `src/components/FilterBar.jsx` | 新增 `peopleOptions` + `coreNeedOptions` props；新增两组 state + 浮层；扩展 onFilter 回调；扩展文字搜索字段 |
| `src/pages/RecordsPage.jsx` | mount 时加载 people/coreNeed options；handleFilter 新增两个条件；FilterBar 调用处加两个 props |
| `src/pages/ThreadDetailPage.jsx` | 同上（`showDate={false}`） |

---

## 三、FilterBar 现有结构速查

**文件：** `src/components/FilterBar.jsx`

现有 props：
```js
FilterBar({ onFilter, categoryOptions, placeholder, showDate })
```

现有内部 state（参考，不要删）：
```js
searchText, selectedEmotions, selectedCategories, selectedDate
showEmotionMenu, showCategoryMenu, showCalendar
calendarYear, calendarMonth, datesWithRecords
```

现有 chip 行顺序：`[情绪 ▾] [已选情绪 ✕...] [类型 ▾] [已选类型 ✕...] [日期 ▾]`

现有 onFilter 调用：
```js
onFilter({ searchText, selectedEmotions, selectedCategories, selectedDate })
```

---

## 四、需要新增的内容

### FilterBar 新增 props

```js
FilterBar({
  onFilter,
  categoryOptions,
  peopleOptions,    // string[] ← 新增，canonical 名称列表
  coreNeedOptions,  // string[] ← 新增，需求词条列表
  placeholder,
  showDate,
})
```

### FilterBar 新增 state

```js
const [selectedPeople, setSelectedPeople] = useState([])
const [selectedCoreNeeds, setSelectedCoreNeeds] = useState([])
const [showPeopleMenu, setShowPeopleMenu] = useState(false)
const [showCoreNeedsMenu, setShowCoreNeedsMenu] = useState(false)
```

### chip 行新增位置

在「类型 ▾」入口之后、「日期 ▾」之前，加入：

```jsx
{/* 人物入口（词库为空时不渲染）*/}
{peopleOptions.length > 0 && (
  <>
    <button onClick={() => { setShowPeopleMenu(v => !v); setShowCoreNeedsMenu(false); setShowEmotionMenu(false); setShowCategoryMenu(false) }}
      style={chipStyle(selectedPeople.length > 0)}>
      人物 ▾
    </button>
    {selectedPeople.map(p => (
      <button key={p} onClick={() => removePerson(p)} style={selectedChipStyle}>
        {p} ✕
      </button>
    ))}
  </>
)}

{/* 需求入口（词库为空时不渲染）*/}
{coreNeedOptions.length > 0 && (
  <>
    <button onClick={() => { setShowCoreNeedsMenu(v => !v); setShowPeopleMenu(false); setShowEmotionMenu(false); setShowCategoryMenu(false) }}
      style={chipStyle(selectedCoreNeeds.length > 0)}>
      需求 ▾
    </button>
    {selectedCoreNeeds.map(n => (
      <button key={n} onClick={() => removeCoreNeed(n)} style={selectedChipStyle}>
        {n} ✕
      </button>
    ))}
  </>
)}
```

### 浮层 UI（复用情绪/类型浮层相同结构）

人物浮层和需求浮层的 UI 模式与现有类型浮层完全一致：
- 点选 chip，选中金色填充
- 右上角或底部 ✅ 按钮关闭
- 点浮层外关闭

### onFilter 回调扩展

```js
// 所有触发 onFilter 的地方统一更新为：
onFilter({
  searchText,
  selectedEmotions,
  selectedCategories,
  selectedPeople,    // ← 新增
  selectedCoreNeeds, // ← 新增
  selectedDate,
})
```

### 重置逻辑追加

FilterBar 的 reset/clear 操作（父页面关闭搜索面板时触发）需追加：
```js
setSelectedPeople([])
setSelectedCoreNeeds([])
setShowPeopleMenu(false)
setShowCoreNeedsMenu(false)
```

### 文字搜索扩展

将现有 `.or()` 从两个字段扩展到五个：

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

---

## 五、父页面变更

### RecordsPage.jsx

**mount 时加载（在现有 categoryOptions 加载旁边追加）：**

```js
import { loadContacts } from '../lib/contactsService'
import { loadCoreNeeds } from '../lib/coreNeedsService'

const [peopleOptions, setPeopleOptions] = useState([])
const [coreNeedOptions, setCoreNeedOptions] = useState([])

// 在 mount useEffect 中追加：
loadContacts().then(list => setPeopleOptions(list.map(c => c.canonical)))
loadCoreNeeds().then(list => setCoreNeedOptions(list.map(n => n.option_value)))
```

**handleFilter 追加两个条件（AND 关系）：**

```js
// hasFilter 判断更新
const hasFilter = searchText.trim() || selectedEmotions.length ||
                  selectedCategories.length || selectedPeople.length ||
                  selectedCoreNeeds.length || selectedDate

// 查询条件追加
if (selectedPeople.length) {
  query = query.overlaps('people_involved', selectedPeople)
}
if (selectedCoreNeeds.length) {
  query = query.overlaps('core_needs', selectedCoreNeeds)
}
```

**select 字段补充：**
```js
.select('id, content, entry_summary, created_at, emotions, emotion_display,
         category_tags, people_involved, core_needs, template_type')
```

**FilterBar 调用处：**
```jsx
<FilterBar
  onFilter={handleFilter}
  categoryOptions={categoryOptions}
  peopleOptions={peopleOptions}
  coreNeedOptions={coreNeedOptions}
  placeholder="搜索记录内容、认知、洞见..."
  showDate={true}
/>
```

### ThreadDetailPage.jsx

变更内容与 RecordsPage 完全对称，差异只有：
- `showDate={false}`
- `.limit(30)`（原有限制保持）
- 查询结果仍需过滤已关联该脉络的 entry（原有逻辑保持，不要动）

---

## 六、成功标准（验收清单）

1. FilterBar chip 行出现「人物 ▾」「需求 ▾」两个新入口
2. 联系人库为空时「人物 ▾」不显示，需求词库为空时「需求 ▾」不显示
3. 选「妈妈」→ 只显示 people_involved 含「妈妈」的记录
4. 选「被理解」→ 与人物筛选叠加（AND），列表进一步缩小
5. 点「妈妈 ✕」→ 只保留需求筛选，列表刷新
6. 搜索「胸口」→ 命中 body_sensations 含该词的记录
7. 搜索「灾难化」→ 命中 cognitive_analysis 含该词的记录
8. ThreadDetailPage 编辑模式：人物/需求筛选正常，已关联 entry 仍被排除
9. 关闭搜索面板时人物/需求筛选完整清空

---

## 七、注意事项

- **FilterBar 不自己调 loadContacts / loadCoreNeeds**——options 从父页面 props 传入，FilterBar 是纯 UI 组件
- **用 `.overlaps()` 不用 `.contains()`**——overlaps 是「任意匹配」，contains 是「全部包含」，语义不同
- **两个父页面同步更新**——RecordsPage 和 ThreadDetailPage 的文字搜索字段扩展都要改，不能只改一个
